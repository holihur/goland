package plugins

import (
	"context"
	"log/slog"
	"strings"
	"sync"
)

// HostManager owns at most one host process per workspace/plugin pair.
type HostManager struct {
	mu    sync.Mutex
	hosts map[string]*Host
	log   *slog.Logger
}

// NewHostManager creates an empty manager.
func NewHostManager(log *slog.Logger) *HostManager {
	if log == nil {
		log = slog.Default()
	}
	return &HostManager{hosts: make(map[string]*Host), log: log}
}

func hostKey(workspaceID, pluginID string) string {
	return workspaceID + "\x00" + pluginID
}

// Ensure returns a running host, starting one if needed. Crashed hosts are
// replaced on the next request.
func (m *HostManager) Ensure(ctx context.Context, spec HostSpec) (*Host, error) {
	key := hostKey(spec.WorkspaceID, spec.PluginID)
	m.mu.Lock()
	existing := m.hosts[key]
	if existing != nil && existing.Healthy() {
		m.mu.Unlock()
		return existing, nil
	}
	if existing != nil {
		delete(m.hosts, key)
	}
	m.mu.Unlock()

	if existing != nil {
		existing.Stop()
	}
	host, err := StartHost(ctx, spec)
	if err != nil {
		return nil, err
	}
	m.mu.Lock()
	if current := m.hosts[key]; current != nil && current.Healthy() {
		// Another request won the race; keep the existing host.
		m.mu.Unlock()
		host.Stop()
		return current, nil
	}
	m.hosts[key] = host
	m.mu.Unlock()
	m.log.Info("plugin host started", "workspace", spec.WorkspaceID, "plugin", spec.PluginID)
	return host, nil
}

// Get returns a running host if one exists.
func (m *HostManager) Get(workspaceID, pluginID string) (*Host, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	host := m.hosts[hostKey(workspaceID, pluginID)]
	if host == nil {
		return nil, false
	}
	return host, host.Healthy()
}

// Stop stops one host.
func (m *HostManager) Stop(workspaceID, pluginID string) {
	key := hostKey(workspaceID, pluginID)
	m.mu.Lock()
	host := m.hosts[key]
	delete(m.hosts, key)
	m.mu.Unlock()
	if host != nil {
		host.Stop()
		m.log.Info("plugin host stopped", "workspace", workspaceID, "plugin", pluginID)
	}
}

// StopWorkspace stops every host belonging to a workspace.
func (m *HostManager) StopWorkspace(workspaceID string) {
	m.mu.Lock()
	var hosts []*Host
	for key, host := range m.hosts {
		if strings.HasPrefix(key, workspaceID+"\x00") {
			hosts = append(hosts, host)
			delete(m.hosts, key)
		}
	}
	m.mu.Unlock()
	for _, host := range hosts {
		host.Stop()
	}
}

// StopPlugin stops every host for a plugin across workspaces.
func (m *HostManager) StopPlugin(pluginID string) {
	suffix := "\x00" + pluginID
	m.mu.Lock()
	var keys []string
	for key := range m.hosts {
		if strings.HasSuffix(key, suffix) {
			keys = append(keys, key)
		}
	}
	hosts := make([]*Host, 0, len(keys))
	for _, key := range keys {
		hosts = append(hosts, m.hosts[key])
		delete(m.hosts, key)
	}
	m.mu.Unlock()
	for _, host := range hosts {
		host.Stop()
	}
}

// StopAll stops every host, used during shutdown.
func (m *HostManager) StopAll() {
	m.mu.Lock()
	hosts := make([]*Host, 0, len(m.hosts))
	for key, host := range m.hosts {
		hosts = append(hosts, host)
		delete(m.hosts, key)
	}
	m.mu.Unlock()
	for _, host := range hosts {
		host.Stop()
	}
}
