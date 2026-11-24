package plugins

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

const (
	DefaultCommandTimeout = 60 * time.Second
	DefaultHookTimeout    = 10 * time.Second
	DefaultInitTimeout    = 15 * time.Second
	DefaultOutputLimit    = 1 << 20
	maxStderrBytes        = 8 << 10
	maxProtocolLine       = 4 << 20
)

// Identity scopes a plugin process to a workspace Unix user.
type Identity interface {
	Env(root string) []string
	Apply(cmd *exec.Cmd)
}

// HostEvent is emitted for plugin UI notifications, output and lifecycle
// changes. Sinks must not block.
type HostEvent struct {
	Type        string
	WorkspaceID string
	PluginID    string
	Output      *OutputNotification
	Status      *StatusNotification
	Panel       *PanelNotification
	Notify      *NotifyNotification
	Log         *LogNotification
	Error       string
	At          time.Time
}

// EventSink receives host events.
type EventSink func(HostEvent)

// HostSpec configures one plugin process.
type HostSpec struct {
	WorkspaceID    string
	PluginID       string
	Root           string
	Executable     string
	Args           []string
	Config         map[string]any
	Identity       Identity
	Sink           EventSink
	Logger         *slog.Logger
	CommandTimeout time.Duration
	HookTimeout    time.Duration
	OutputLimit    int
}

type pendingCall struct {
	ch chan *RPCResponse
}

// Host is a single running plugin process speaking JSON-RPC over stdio.
type Host struct {
	spec HostSpec

	cmd   *exec.Cmd
	stdin io.WriteCloser

	writeMu sync.Mutex
	nextID  atomic.Int64

	mu      sync.Mutex
	pending map[int64]*pendingCall
	outputs map[string]*strings.Builder

	done     chan struct{}
	stopOnce sync.Once
	stopping atomic.Bool

	stateMu sync.Mutex
	state   string
	lastErr string
	stderr  string
}

// StartHost launches the plugin, performs initialize/health, and returns it.
func StartHost(ctx context.Context, spec HostSpec) (*Host, error) {
	if spec.Executable == "" || spec.Root == "" {
		return nil, errors.New("plugin executable and workspace root are required")
	}
	if spec.Logger == nil {
		spec.Logger = slog.Default()
	}
	if spec.CommandTimeout <= 0 {
		spec.CommandTimeout = DefaultCommandTimeout
	}
	if spec.HookTimeout <= 0 {
		spec.HookTimeout = DefaultHookTimeout
	}
	if spec.OutputLimit <= 0 {
		spec.OutputLimit = DefaultOutputLimit
	}
	cmd := exec.Command(spec.Executable, spec.Args...)
	cmd.Dir = spec.Root
	if spec.Identity != nil {
		cmd.Env = spec.Identity.Env(spec.Root)
		spec.Identity.Apply(cmd)
	} else {
		cmd.Env = os.Environ()
	}
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.Setpgid = true

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start plugin: %w", err)
	}
	h := &Host{
		spec: spec, cmd: cmd, stdin: stdin,
		pending: make(map[int64]*pendingCall),
		outputs: make(map[string]*strings.Builder),
		done:    make(chan struct{}),
		state:   "starting",
	}
	go h.readStdout(stdout)
	go h.readStderr(stderr)
	go h.wait()

	initCtx, cancel := context.WithTimeout(ctx, DefaultInitTimeout)
	defer cancel()
	params := InitializeParams{
		APIVersion: APIVersion, WorkspaceID: spec.WorkspaceID,
		RootPath: spec.Root, Config: spec.Config,
	}
	raw, err := h.call(initCtx, MethodInitialize, params, DefaultInitTimeout)
	if err != nil {
		h.Stop()
		return nil, fmt.Errorf("initialize plugin: %w", err)
	}
	var initResult InitializeResult
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &initResult); err != nil {
			h.Stop()
			return nil, fmt.Errorf("decode initialize result: %w", err)
		}
	}
	healthCtx, healthCancel := context.WithTimeout(ctx, 5*time.Second)
	defer healthCancel()
	if raw, err := h.call(healthCtx, MethodHealth, nil, 5*time.Second); err != nil {
		h.Stop()
		return nil, fmt.Errorf("plugin health check: %w", err)
	} else if len(raw) > 0 {
		var health HealthResult
		if err := json.Unmarshal(raw, &health); err != nil {
			h.Stop()
			return nil, fmt.Errorf("decode health result: %w", err)
		}
		if health.Status != "" && health.Status != "ok" {
			h.Stop()
			return nil, fmt.Errorf("plugin health status %q", health.Status)
		}
	}
	h.setState("running", "")
	return h, nil
}

func (h *Host) readStdout(reader io.Reader) {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 64<<10), maxProtocolLine)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		h.handleMessage([]byte(line))
	}
}

func (h *Host) readStderr(reader io.Reader) {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 64<<10), 1<<20)
	for scanner.Scan() {
		line := scanner.Text()
		h.stateMu.Lock()
		h.stderr += line + "\n"
		if len(h.stderr) > maxStderrBytes {
			h.stderr = h.stderr[len(h.stderr)-maxStderrBytes:]
		}
		h.stateMu.Unlock()
	}
}

func (h *Host) handleMessage(data []byte) {
	var envelope struct {
		JSONRPC string          `json:"jsonrpc"`
		ID      *int64          `json:"id"`
		Method  string          `json:"method"`
		Params  json.RawMessage `json:"params"`
		Result  json.RawMessage `json:"result"`
		Error   *RPCError       `json:"error"`
	}
	if err := json.Unmarshal(data, &envelope); err != nil || envelope.JSONRPC != JSONRPCVersion {
		return
	}
	if envelope.Method != "" {
		if envelope.ID != nil {
			h.writeResponse(&RPCResponse{
				JSONRPC: JSONRPCVersion, ID: envelope.ID,
				Error: &RPCError{Code: -32601, Message: "method not found"},
			})
			return
		}
		h.handleNotification(envelope.Method, envelope.Params)
		return
	}
	if envelope.ID == nil {
		return
	}
	h.mu.Lock()
	call := h.pending[*envelope.ID]
	if call != nil {
		delete(h.pending, *envelope.ID)
	}
	h.mu.Unlock()
	if call == nil {
		return
	}
	call.ch <- &RPCResponse{JSONRPC: envelope.JSONRPC, ID: envelope.ID, Result: envelope.Result, Error: envelope.Error}
}

func (h *Host) handleNotification(method string, params json.RawMessage) {
	event := HostEvent{Type: method, WorkspaceID: h.spec.WorkspaceID, PluginID: h.spec.PluginID, At: time.Now()}
	switch method {
	case NotifyOutput:
		var payload OutputNotification
		if err := json.Unmarshal(params, &payload); err != nil {
			return
		}
		h.mu.Lock()
		if builder := h.outputs[payload.RequestID]; builder != nil {
			if builder.Len() < h.spec.OutputLimit {
				remaining := h.spec.OutputLimit - builder.Len()
				if len(payload.Chunk) > remaining {
					payload.Chunk = payload.Chunk[:remaining]
				}
				builder.WriteString(payload.Chunk)
			}
		}
		h.mu.Unlock()
		event.Output = &payload
	case NotifyStatus:
		var payload StatusNotification
		if err := json.Unmarshal(params, &payload); err != nil {
			return
		}
		event.Status = &payload
	case NotifyPanel:
		var payload PanelNotification
		if err := json.Unmarshal(params, &payload); err != nil {
			return
		}
		event.Panel = &payload
	case NotifyNotify:
		var payload NotifyNotification
		if err := json.Unmarshal(params, &payload); err != nil {
			return
		}
		event.Notify = &payload
	case NotifyLog:
		var payload LogNotification
		if err := json.Unmarshal(params, &payload); err != nil {
			return
		}
		event.Log = &payload
	default:
		return
	}
	if h.spec.Sink != nil {
		h.spec.Sink(event)
	}
}

func (h *Host) writeMessage(payload any) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	h.writeMu.Lock()
	defer h.writeMu.Unlock()
	if h.stopping.Load() {
		return errors.New("plugin is stopping")
	}
	_, err = h.stdin.Write(append(data, '\n'))
	return err
}

func (h *Host) writeResponse(resp *RPCResponse) {
	_ = h.writeMessage(resp)
}

func (h *Host) call(ctx context.Context, method string, params any, timeout time.Duration) (json.RawMessage, error) {
	id := h.nextID.Add(1)
	call := &pendingCall{ch: make(chan *RPCResponse, 1)}
	h.mu.Lock()
	if h.stopping.Load() {
		h.mu.Unlock()
		return nil, errors.New("plugin is not running")
	}
	h.pending[id] = call
	h.mu.Unlock()

	if err := h.writeMessage(RPCRequest{JSONRPC: JSONRPCVersion, ID: &id, Method: method, Params: marshalParams(params)}); err != nil {
		h.removePending(id)
		return nil, err
	}
	if timeout <= 0 {
		timeout = h.spec.CommandTimeout
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case resp := <-call.ch:
		if resp.Error != nil {
			return nil, resp.Error
		}
		return resp.Result, nil
	case <-timer.C:
		h.removePending(id)
		_ = h.writeMessage(RPCRequest{JSONRPC: JSONRPCVersion, Method: NotifyCancel, Params: marshalParams(CancelNotification{RequestID: requestIDFor(method, id)})})
		return nil, fmt.Errorf("plugin %s timed out after %s", method, timeout)
	case <-ctx.Done():
		h.removePending(id)
		return nil, ctx.Err()
	case <-h.done:
		h.removePending(id)
		return nil, errors.New("plugin exited")
	}
}

func (h *Host) removePending(id int64) {
	h.mu.Lock()
	delete(h.pending, id)
	h.mu.Unlock()
}

func marshalParams(params any) json.RawMessage {
	if params == nil {
		return nil
	}
	data, err := json.Marshal(params)
	if err != nil {
		return nil
	}
	return data
}

func requestIDFor(method string, id int64) string {
	return fmt.Sprintf("%s-%d", method, id)
}

// ExecuteCommand runs a plugin command and returns its aggregated output.
func (h *Host) ExecuteCommand(ctx context.Context, req CommandRequest) (CommandResult, error) {
	if req.RequestID == "" {
		req.RequestID = fmt.Sprintf("cmd-%d", h.nextID.Load()+1)
	}
	builder := &strings.Builder{}
	h.mu.Lock()
	h.outputs[req.RequestID] = builder
	h.mu.Unlock()
	defer func() {
		h.mu.Lock()
		delete(h.outputs, req.RequestID)
		h.mu.Unlock()
	}()
	raw, err := h.call(ctx, MethodCommand, req, h.spec.CommandTimeout)
	if err != nil {
		return CommandResult{Output: builder.String()}, err
	}
	var result CommandResult
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &result); err != nil {
			return CommandResult{Output: builder.String()}, fmt.Errorf("decode command result: %w", err)
		}
	}
	if result.Output == "" {
		result.Output = builder.String()
	} else if builder.Len() > 0 {
		result.Output = builder.String() + result.Output
	}
	if len(result.Output) > h.spec.OutputLimit {
		result.Output = result.Output[len(result.Output)-h.spec.OutputLimit:]
	}
	return result, nil
}

// RunHook executes a lifecycle hook.
func (h *Host) RunHook(ctx context.Context, kind HookKind, req HookRequest) (HookResult, error) {
	method := map[HookKind]string{
		HookOpen: MethodHookOpen, HookSave: MethodHookSave,
		HookPreCommit: MethodPreCommit, HookPostPull: MethodPostPull,
	}[kind]
	if method == "" {
		return HookResult{}, fmt.Errorf("unknown hook %q", kind)
	}
	if req.RequestID == "" {
		req.RequestID = fmt.Sprintf("hook-%d", h.nextID.Load()+1)
	}
	raw, err := h.call(ctx, method, req, h.spec.HookTimeout)
	if err != nil {
		return HookResult{}, err
	}
	var result HookResult
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &result); err != nil {
			return HookResult{}, fmt.Errorf("decode hook result: %w", err)
		}
	}
	return result, nil
}

// Cancel asks the plugin to stop a long-running request.
func (h *Host) Cancel(requestID string) error {
	return h.writeMessage(RPCRequest{JSONRPC: JSONRPCVersion, Method: MethodCancel, Params: marshalParams(CancelNotification{RequestID: requestID})})
}

func (h *Host) wait() {
	err := h.cmd.Wait()
	close(h.done)
	h.mu.Lock()
	pending := h.pending
	h.pending = make(map[int64]*pendingCall)
	h.mu.Unlock()
	for _, call := range pending {
		select {
		case call.ch <- &RPCResponse{JSONRPC: JSONRPCVersion, Error: &RPCError{Code: -32000, Message: "plugin exited"}}:
		default:
		}
	}
	if h.stopping.Load() {
		h.setState("stopped", "")
		return
	}
	message := "plugin exited"
	if err != nil {
		message = err.Error()
	}
	h.setState("crashed", message)
	if h.spec.Sink != nil {
		h.spec.Sink(HostEvent{Type: "crashed", WorkspaceID: h.spec.WorkspaceID, PluginID: h.spec.PluginID, Error: message, At: time.Now()})
	}
}

// Stop shuts the plugin down gracefully and then kills its process group.
func (h *Host) Stop() {
	h.stopOnce.Do(func() {
		_ = h.writeMessage(RPCRequest{JSONRPC: JSONRPCVersion, Method: MethodShutdown, Params: marshalParams(map[string]any{})})
		h.stopping.Store(true)
		_ = h.stdin.Close()
		select {
		case <-h.done:
		case <-time.After(2 * time.Second):
			h.kill()
			select {
			case <-h.done:
			case <-time.After(2 * time.Second):
			}
		}
	})
}

func (h *Host) kill() {
	if h.cmd == nil || h.cmd.Process == nil {
		return
	}
	if err := syscall.Kill(-h.cmd.Process.Pid, syscall.SIGKILL); err != nil {
		_ = h.cmd.Process.Kill()
	}
}

// Pid returns the plugin process id (0 before start).
func (h *Host) Pid() int {
	if h.cmd == nil || h.cmd.Process == nil {
		return 0
	}
	return h.cmd.Process.Pid
}

// Healthy reports whether the process is running normally.
func (h *Host) Healthy() bool {
	h.stateMu.Lock()
	defer h.stateMu.Unlock()
	return h.state == "running"
}

// LastError returns the crash/startup error.
func (h *Host) LastError() string {
	h.stateMu.Lock()
	defer h.stateMu.Unlock()
	message := strings.TrimSpace(h.stderr)
	if h.lastErr != "" {
		if message != "" {
			message += "\n"
		}
		message += h.lastErr
	}
	return message
}

func (h *Host) setState(state, reason string) {
	h.stateMu.Lock()
	h.state = state
	if reason != "" {
		h.lastErr = reason
	}
	h.stateMu.Unlock()
}
