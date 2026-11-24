package server

import (
	"net/http"
	"time"

	"github.com/gorilla/websocket"

	"goland/internal/plugins"
)

func (s *Server) pluginEventWS(w http.ResponseWriter, r *http.Request) {
	ws, ok := s.workspaceFor(w, r)
	if !ok {
		return
	}
	if !s.originAllowed(r) {
		writeError(w, http.StatusForbidden, "origin", "websocket origin is not allowed")
		return
	}
	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	conn.SetReadLimit(64 << 10)
	conn.SetPongHandler(func(string) error { return conn.SetReadDeadline(time.Now().Add(60 * time.Second)) })
	_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))

	events, cancel := s.pluginEvents.subscribe(ws.ID.Hex())
	defer cancel()
	closed := make(chan struct{})
	go func() {
		defer close(closed)
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()
	if err := conn.WriteJSON(map[string]any{"type": "hello", "workspaceId": ws.ID.Hex()}); err != nil {
		return
	}
	ticker := time.NewTicker(25 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case event := <-events:
			_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if err := conn.WriteJSON(pluginEventPayload(event)); err != nil {
				return
			}
		case <-ticker.C:
			if err := conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second)); err != nil {
				return
			}
		case <-closed:
			return
		}
	}
}

func pluginEventPayload(event plugins.HostEvent) map[string]any {
	eventType := map[string]string{
		"command/output": "output",
		"ui/status":      "status",
		"ui/panel":       "panel",
		"ui/notify":      "notify",
	}[event.Type]
	if eventType == "" {
		eventType = event.Type
	}
	payload := map[string]any{
		"type":     eventType,
		"pluginId": event.PluginID,
		"at":       event.At.UTC().Format(time.RFC3339Nano),
	}
	if event.Output != nil {
		payload["requestId"] = event.Output.RequestID
		payload["chunk"] = event.Output.Chunk
	}
	if event.Status != nil {
		payload["statusId"] = event.Status.ID
		payload["text"] = event.Status.Text
		payload["tooltip"] = event.Status.Tooltip
	}
	if event.Panel != nil {
		payload["panelId"] = event.Panel.PanelID
		payload["title"] = event.Panel.Title
		payload["state"] = event.Panel.State
		payload["output"] = event.Panel.Output
	}
	if event.Notify != nil {
		payload["level"] = event.Notify.Level
		payload["message"] = event.Notify.Message
	}
	if event.Log != nil {
		payload["level"] = event.Log.Level
		payload["message"] = event.Log.Message
	}
	if event.Error != "" {
		payload["error"] = event.Error
	}
	return payload
}
