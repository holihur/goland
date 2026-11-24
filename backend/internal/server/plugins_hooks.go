package server

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"time"

	"goland/internal/plugins"
	"goland/internal/store"
)

type pluginHookError struct {
	Blocked bool
	Message string
}

func (e *pluginHookError) Error() string { return e.Message }

type pluginHookResult struct {
	Content *string
	Notes   []string
}

func hookFor(manifest *plugins.Manifest, kind plugins.HookKind) *plugins.Hook {
	switch kind {
	case plugins.HookOpen:
		return manifest.Contributes.Hooks.OnOpen
	case plugins.HookSave:
		return manifest.Contributes.Hooks.OnSave
	case plugins.HookPreCommit:
		return manifest.Contributes.Hooks.PreCommit
	case plugins.HookPostPull:
		return manifest.Contributes.Hooks.PostPull
	default:
		return nil
	}
}

// runPluginHooks invokes every enabled plugin that contributes the hook, in
// stable plugin-id order. Content returned by a hook is passed to the next one.
func (s *Server) runPluginHooks(ctx context.Context, ws *store.Workspace, kind plugins.HookKind, req plugins.HookRequest) (pluginHookResult, error) {
	result := pluginHookResult{}
	states, err := s.store.ListWorkspacePlugins(ctx, ws.OwnerID, ws.ID)
	if err != nil {
		return result, err
	}
	sort.Slice(states, func(i, j int) bool { return states[i].PluginID < states[j].PluginID })
	req.Kind = string(kind)
	content := req.Content
	for _, state := range states {
		if !state.Enabled {
			continue
		}
		rec, err := s.store.FindPlugin(ctx, state.PluginID)
		if err != nil {
			continue
		}
		manifest, err := s.pluginManifest(rec)
		if err != nil {
			s.log.Warn("plugin manifest invalid", "plugin", rec.PluginID, "err", err)
			continue
		}
		hook := hookFor(manifest, kind)
		if hook == nil {
			continue
		}
		req.Content = content
		req.Inputs = plugins.ConfigWithDefaults(manifest, state.Config)
		req.RequestID = fmt.Sprintf("hook-%s-%s-%d", kind, rec.PluginID, time.Now().UnixNano())
		host, err := s.ensurePluginHost(ctx, ws, rec, &state)
		started := time.Now()
		if err == nil {
			var out plugins.HookResult
			out, err = host.RunHook(ctx, kind, req)
			if err == nil {
				if !out.Allow {
					message := out.Message
					if message == "" {
						message = fmt.Sprintf("plugin %s blocked %s", rec.PluginID, kind)
					}
					s.hookAudit(ctx, ws, kind, req.Path, rec.PluginID, started, "blocked")
					return result, &pluginHookError{Blocked: true, Message: message}
				}
				if out.Content != nil {
					content = *out.Content
					result.Content = &content
				}
				result.Notes = append(result.Notes, out.Notes...)
				s.hookAudit(ctx, ws, kind, req.Path, rec.PluginID, started, "allow")
				continue
			}
		}
		mode := hook.FailureMode(kind)
		s.hookAudit(ctx, ws, kind, req.Path, rec.PluginID, started, "error")
		if mode == "closed" {
			return result, &pluginHookError{Blocked: true, Message: fmt.Sprintf("plugin %s failed: %v", rec.PluginID, err)}
		}
		s.log.Warn("plugin hook failed open", "plugin", rec.PluginID, "hook", kind, "err", err)
	}
	return result, nil
}

func (s *Server) hookAudit(_ context.Context, ws *store.Workspace, kind plugins.HookKind, path, pluginID string, started time.Time, outcome string) {
	detail := fmt.Sprintf("%s:%s:%s:%s", pluginID, kind, path, time.Since(started).Round(time.Millisecond))
	detail += ":" + outcome
	s.store.RecordAudit(context.Background(), &store.AuditEvent{
		Action: "plugin.hook", Resource: ws.ID.Hex(), Detail: detail, CreatedAt: time.Now().UTC(),
	})
}

func writeHookError(w http.ResponseWriter, err error) {
	var hookErr *pluginHookError
	if errors.As(err, &hookErr) {
		code := "plugin_hook_failed"
		status := http.StatusBadGateway
		if hookErr.Blocked {
			code, status = "plugin_blocked", http.StatusForbidden
		}
		writeError(w, status, code, hookErr.Message)
		return
	}
	writeError(w, http.StatusInternalServerError, "internal", "plugin hook failed")
}

// fileContentResponse keeps the files.Content JSON shape and adds plugin notes.
type fileContentResponse struct {
	Path        string    `json:"path"`
	Content     string    `json:"content,omitempty"`
	ETag        string    `json:"etag,omitempty"`
	Size        int64     `json:"size"`
	ModifiedAt  time.Time `json:"modifiedAt"`
	Binary      bool      `json:"binary"`
	PluginNotes []string  `json:"pluginNotes,omitempty"`
}
