package server

import (
	"sync"

	"goland/internal/plugins"
)

// pluginEventHub fans plugin events out to workspace subscribers.
type pluginEventHub struct {
	mu   sync.Mutex
	subs map[string]map[chan plugins.HostEvent]struct{}
}

func newPluginEventHub() *pluginEventHub {
	return &pluginEventHub{subs: make(map[string]map[chan plugins.HostEvent]struct{})}
}

func (h *pluginEventHub) subscribe(workspaceID string) (<-chan plugins.HostEvent, func()) {
	ch := make(chan plugins.HostEvent, 64)
	h.mu.Lock()
	if h.subs[workspaceID] == nil {
		h.subs[workspaceID] = make(map[chan plugins.HostEvent]struct{})
	}
	h.subs[workspaceID][ch] = struct{}{}
	h.mu.Unlock()
	cancel := func() {
		h.mu.Lock()
		if current := h.subs[workspaceID]; current != nil {
			delete(current, ch)
			if len(current) == 0 {
				delete(h.subs, workspaceID)
			}
		}
		h.mu.Unlock()
	}
	return ch, cancel
}

func (h *pluginEventHub) publish(event plugins.HostEvent) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs[event.WorkspaceID] {
		select {
		case ch <- event:
		default:
			// A slow client must not block the plugin host reader.
		}
	}
}
