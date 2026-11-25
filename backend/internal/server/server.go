package server

import (
	"bufio"
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"goland/internal/auth"
	"goland/internal/config"
	"goland/internal/files"
	"goland/internal/git"
	"goland/internal/plugins"
	"goland/internal/store"
	"goland/internal/workspace"
)

type Server struct {
	cfg           *config.Config
	store         *store.Store
	auth          *auth.Manager
	workspaces    *workspace.Manager
	files         *files.Manager
	git           *git.Manager
	log           *slog.Logger
	limiter       *loginLimiter
	debugMu       sync.Mutex
	debugSess     map[string]*debugSession
	browsers      map[string]*browserSession
	plugins       *plugins.Installer
	pluginHosts   *plugins.HostManager
	pluginEvents  *pluginEventHub
	pluginMu      sync.Mutex
	pluginWorkers map[string]map[string]func()
	oidc          *oidcManager
}

func New(cfg *config.Config, st *store.Store, am *auth.Manager, wm *workspace.Manager, fm *files.Manager, gm *git.Manager, log *slog.Logger) http.Handler {
	s := &Server{
		cfg: cfg, store: st, auth: am, workspaces: wm, files: fm, git: gm, log: log,
		limiter: newLoginLimiter(), debugSess: make(map[string]*debugSession),
		plugins:     plugins.NewInstaller(filepath.Join(cfg.DataDir, "plugins")),
		pluginHosts: plugins.NewHostManager(log), pluginEvents: newPluginEventHub(),
		pluginWorkers: make(map[string]map[string]func()),
		oidc:          newOIDCManager(cfg),
	}
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(securityHeaders)
	r.Use(s.accessLog)

	r.Get("/api/health", s.health)
	r.Post("/api/auth/login", s.login)
	r.Post("/api/auth/mfa/verify", s.verifyMFA)
	r.Get("/api/auth/oidc/config", s.oidcConfig)
	r.Get("/api/auth/oidc/login", s.oidcLogin)
	r.Get("/api/auth/oidc/callback", s.oidcCallback)

	r.Route("/api", func(api chi.Router) {
		api.Use(am.Authenticate)
		api.Use(am.CSRF)
		api.Use(am.RequireMFA(cfg.MFARequired))
		api.Get("/auth/me", s.me)
		api.Post("/auth/logout", s.logout)
		api.Get("/auth/mfa/status", s.mfaStatus)
		api.Post("/auth/mfa/setup", s.setupMFA)
		api.Post("/auth/mfa/enable", s.enableMFA)
		api.Post("/auth/mfa/disable", s.disableMFA)
		api.Get("/auth/tokens", s.listAPITokens)
		api.Post("/auth/tokens", s.createAPIToken)
		api.Delete("/auth/tokens/{tokenID}", s.deleteAPIToken)
		api.Post("/mcp", s.mcpEndpoint)

		api.Route("/admin", func(admin chi.Router) {
			admin.Use(requireAdmin)
			admin.Get("/users", s.listUsers)
			admin.Post("/users", s.createUser)
			admin.Get("/plugins", s.listPlugins)
			admin.Post("/plugins", s.installPluginFromPath)
			admin.Post("/plugins/upload", s.uploadPlugin)
			admin.Delete("/plugins/{pluginID}", s.uninstallPlugin)
		})

		api.Route("/workspaces", func(ws chi.Router) {
			ws.Get("/", s.listWorkspaces)
			ws.Post("/", s.createWorkspace)
			ws.Route("/{workspaceID}", func(one chi.Router) {
				one.Get("/", s.getWorkspace)
				one.Delete("/", s.deleteWorkspace)
				one.Get("/tree", s.listTree)
				one.Get("/file", s.readFile)
				one.Put("/file", s.writeFile)
				one.Post("/entry", s.createEntry)
				one.Post("/rename", s.renameEntry)
				one.Delete("/entry", s.deleteEntry)
				one.Get("/search", s.search)
				one.Get("/search/content", s.contentSearch)
				one.Post("/search/replace", s.replaceContent)
				one.Get("/git/status", s.gitStatus)
				one.Get("/git/diff", s.gitDiff)
				one.Post("/git/stage", s.gitStage)
				one.Post("/git/unstage", s.gitUnstage)
				one.Post("/git/commit", s.gitCommit)
				one.Get("/git/branches", s.gitBranches)
				one.Post("/git/branch", s.gitCreateBranch)
				one.Post("/git/checkout", s.gitCheckout)
				one.Post("/git/pull", s.gitPull)
				one.Post("/git/push", s.gitPush)
				one.Get("/git/log", s.gitLog)
				one.Get("/git/conflict", s.gitConflict)
				one.Post("/git/resolve", s.gitResolve)
				one.Post("/git/apply", s.gitApplyPatch)
				one.Get("/tasks", s.listTasks)
				one.Get("/tasks/runs", s.taskRuns)
				one.Get("/tests", s.listTests)
				one.Post("/tests/run", s.runTest)
				one.Get("/plugins", s.listWorkspacePlugins)
				one.Get("/plugins/{pluginID}/frontend/*", s.pluginFrontendAsset)
				one.Put("/plugins/{pluginID}", s.updateWorkspacePlugin)
				one.Delete("/plugins/{pluginID}", s.removeWorkspacePlugin)
				one.Get("/debug/config", s.debugConfig)
				one.Post("/browser/session", s.startBrowser)
				one.Delete("/browser/session/{browserID}", s.stopBrowser)
				one.Post("/browser/session/{browserID}/reload", s.reloadBrowser)
				one.Post("/plugins/{pluginID}/commands/{commandID}", s.executePluginCommand)
				one.Post("/plugins/{pluginID}/cancel", s.cancelPluginCommand)
				one.Get("/terminal", s.terminalInfo)
			})
		})

		api.Get("/ws/workspaces/{workspaceID}/terminal", s.terminalWS)
		api.Get("/ws/workspaces/{workspaceID}/lsp", s.lspWS)
		api.Get("/ws/workspaces/{workspaceID}/run", s.taskWS)
		api.Get("/ws/workspaces/{workspaceID}/debug/{kind}", s.debugWS)
		api.Get("/ws/workspaces/{workspaceID}/plugins", s.pluginEventWS)
		api.Get("/ws/workspaces/{workspaceID}/plugins/{pluginID}/lsp/{serverID}", s.pluginLSPWS)
		api.Get("/ws/workspaces/{workspaceID}/plugins/{pluginID}/debug/{kind}", s.pluginDAPWS)
	})

	r.NotFound(s.notFound)
	return r
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := s.store.Ping(ctx); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"status": "degraded", "mongo": "unavailable"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "mongo": "ok", "time": time.Now().UTC()})
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFrom(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{
		"user": user, "mfaRequired": s.cfg.MFARequired,
		"mfaSetupRequired": s.cfg.MFARequired && user != nil && !user.MFAEnabled,
	})
}

func (s *Server) notFound(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		writeError(w, http.StatusNotFound, "not_found", "not found")
		return
	}
	if s.cfg.WebDist != "" {
		s.serveSPA(w, r)
		return
	}
	http.NotFound(w, r)
}

func (s *Server) serveSPA(w http.ResponseWriter, r *http.Request) {
	index := filepath.Join(s.cfg.WebDist, "index.html")
	if _, err := os.Stat(index); err != nil {
		http.NotFound(w, r)
		return
	}
	clean := filepath.Clean("/" + r.URL.Path)
	target := filepath.Join(s.cfg.WebDist, filepath.FromSlash(clean))
	if target != s.cfg.WebDist && !strings.HasPrefix(target, s.cfg.WebDist+string(os.PathSeparator)) {
		http.NotFound(w, r)
		return
	}
	if info, err := os.Stat(target); err == nil && !info.IsDir() {
		if strings.Contains(r.URL.Path, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		http.ServeFile(w, r, target)
		return
	}
	http.ServeFile(w, r, index)
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'")
		next.ServeHTTP(w, r)
	})
}

func (s *Server) accessLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := &statusWriter{ResponseWriter: w, status: 200}
		next.ServeHTTP(ww, r)
		s.log.Info("http", "method", r.Method, "path", r.URL.Path, "status", ww.status, "dur", time.Since(start).String(), "ip", r.RemoteAddr)
	})
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (w *statusWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("hijack not supported")
	}
	return h.Hijack()
}

func requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !auth.IsAdmin(auth.UserFrom(r.Context())) {
			writeError(w, http.StatusForbidden, "forbidden", "admin access required")
			return
		}
		next.ServeHTTP(w, r)
	})
}
