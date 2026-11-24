package plugins

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

// TestPluginHelperProcess is re-executed as a fake plugin binary by host tests.
func TestPluginHelperProcess(t *testing.T) {
	if os.Getenv("GO_WANT_PLUGIN_HELPER") != "1" {
		return
	}
	mode := os.Getenv("PLUGIN_HELPER_MODE")
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 64<<10), 1<<20)
	encoder := json.NewEncoder(os.Stdout)
	write := func(value any) { _ = encoder.Encode(value) }
	for scanner.Scan() {
		var req RPCRequest
		if err := json.Unmarshal(scanner.Bytes(), &req); err != nil {
			continue
		}
		respond := func(result any) {
			raw, _ := json.Marshal(result)
			write(RPCResponse{JSONRPC: JSONRPCVersion, ID: req.ID, Result: raw})
		}
		switch req.Method {
		case MethodInitialize:
			if mode == "fail-init" {
				write(RPCResponse{JSONRPC: JSONRPCVersion, ID: req.ID, Error: &RPCError{Code: 1, Message: "init failed"}})
				continue
			}
			respond(InitializeResult{Name: "helper", Version: "1.0.0"})
		case MethodHealth:
			respond(HealthResult{Status: "ok"})
		case MethodCommand:
			var params CommandRequest
			_ = json.Unmarshal(req.Params, &params)
			switch mode {
			case "crash":
				fmt.Fprintln(os.Stderr, "helper crashed")
				os.Exit(3)
			case "timeout":
				continue
			case "spam":
				for i := 0; i < 20; i++ {
					write(RPCRequest{JSONRPC: JSONRPCVersion, Method: NotifyOutput, Params: marshalParams(OutputNotification{
						RequestID: params.RequestID, Chunk: strings.Repeat("x", 50),
					})})
				}
			case "env":
				cwd, _ := os.Getwd()
				respond(CommandResult{Output: fmt.Sprintf("cwd=%s home=%s tmp=%s", cwd, os.Getenv("HOME"), os.Getenv("TMPDIR"))})
				continue
			default:
				write(RPCRequest{JSONRPC: JSONRPCVersion, Method: NotifyOutput, Params: marshalParams(OutputNotification{
					RequestID: params.RequestID, Chunk: "chunk:",
				})})
			}
			respond(CommandResult{Output: "done:" + params.CommandID})
		case MethodHookOpen, MethodHookSave, MethodPreCommit, MethodPostPull:
			var params HookRequest
			_ = json.Unmarshal(req.Params, &params)
			switch mode {
			case "hook-timeout":
				continue
			case "block":
				respond(HookResult{Allow: false, Message: "blocked by helper"})
			case "save-transform":
				content := params.Content + "// formatted\n"
				respond(HookResult{Allow: true, Content: &content})
			case "crash":
				os.Exit(4)
			default:
				respond(HookResult{Allow: true, Notes: []string{"ok"}})
			}
		case MethodShutdown:
			return
		}
	}
}

func helperSpec(t *testing.T, mode string) HostSpec {
	t.Helper()
	root := t.TempDir()
	return HostSpec{
		WorkspaceID: "ws1",
		PluginID:    "helper.plugin",
		Root:        root,
		Executable:  os.Args[0],
		Args:        []string{"-test.run=^TestPluginHelperProcess$"},
		Config:      map[string]any{"x": "y"},
		Logger:      nil,
	}
}

func withHelperEnv(t *testing.T, spec HostSpec, mode string) HostSpec {
	t.Helper()
	if spec.Args == nil {
		spec.Args = []string{"-test.run=^TestPluginHelperProcess$"}
	}
	spec.Args = append(spec.Args, "--")
	t.Setenv("GO_WANT_PLUGIN_HELPER", "1")
	// The helper reads the mode from its own environment; Host passes the
	// current process environment when Identity is nil.
	t.Setenv("PLUGIN_HELPER_MODE", mode)
	return spec
}

type fakeIdentity struct {
	home string
	root string
}

func (f *fakeIdentity) Env(root string) []string {
	f.root = root
	return append(os.Environ(), "HOME="+f.home, "TMPDIR="+f.home+"/tmp", "PLUGIN_IDENTITY=1")
}

func (f *fakeIdentity) Apply(_ *exec.Cmd) {}

func TestHostLifecycleAndIdentity(t *testing.T) {
	identity := &fakeIdentity{home: t.TempDir()}
	spec := withHelperEnv(t, helperSpec(t, ""), "env")
	spec.Identity = identity
	events := make(chan HostEvent, 16)
	spec.Sink = func(event HostEvent) { events <- event }

	host, err := StartHost(context.Background(), spec)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(host.Stop)
	if !host.Healthy() {
		t.Fatal("host is not healthy after initialize")
	}
	if identity.root != spec.Root {
		t.Fatalf("identity root = %q", identity.root)
	}
	result, err := host.ExecuteCommand(context.Background(), CommandRequest{RequestID: "r1", CommandID: "helper.hello"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(result.Output, "cwd="+spec.Root) {
		t.Fatalf("cwd not forwarded: %q", result.Output)
	}
	if !strings.Contains(result.Output, "home="+identity.home) {
		t.Fatalf("HOME not forwarded: %q", result.Output)
	}
	if !strings.Contains(result.Output, "tmp="+identity.home+"/tmp") {
		t.Fatalf("TMPDIR not forwarded: %q", result.Output)
	}

	hook, err := host.RunHook(context.Background(), HookSave, HookRequest{Path: "a.go", Content: "x"})
	if err != nil {
		t.Fatal(err)
	}
	if !hook.Allow {
		t.Fatal("hook was not allowed")
	}
	pid := host.Pid()
	host.Stop()
	if host.Healthy() {
		t.Fatal("host still healthy after stop")
	}
	if pid > 0 {
		deadline := time.Now().Add(2 * time.Second)
		for {
			err := syscall.Kill(pid, 0)
			if err != nil {
				break
			}
			if time.Now().After(deadline) {
				t.Fatalf("plugin process %d is still alive", pid)
			}
			time.Sleep(20 * time.Millisecond)
		}
	}
}

func TestHostCommandOutputAndLimit(t *testing.T) {
	spec := withHelperEnv(t, helperSpec(t, ""), "spam")
	spec.OutputLimit = 100
	host, err := StartHost(context.Background(), spec)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(host.Stop)
	result, err := host.ExecuteCommand(context.Background(), CommandRequest{RequestID: "r2", CommandID: "helper.spam"})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Output) > 100 {
		t.Fatalf("output limit not enforced: %d", len(result.Output))
	}
	if !strings.Contains(result.Output, "done:helper.spam") {
		t.Fatalf("response output missing: %q", result.Output)
	}
}

func TestHostCommandTimeoutAndCancel(t *testing.T) {
	spec := withHelperEnv(t, helperSpec(t, ""), "timeout")
	spec.CommandTimeout = 150 * time.Millisecond
	host, err := StartHost(context.Background(), spec)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(host.Stop)
	start := time.Now()
	_, err = host.ExecuteCommand(context.Background(), CommandRequest{RequestID: "slow", CommandID: "helper.slow"})
	if err == nil || !strings.Contains(err.Error(), "timed out") {
		t.Fatalf("expected timeout, got %v", err)
	}
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Fatalf("timeout took %s", elapsed)
	}
	if err := host.Cancel("slow"); err != nil {
		t.Fatalf("cancel: %v", err)
	}
}

func TestHostCrashAndPendingRequests(t *testing.T) {
	spec := withHelperEnv(t, helperSpec(t, ""), "crash")
	events := make(chan HostEvent, 8)
	spec.Sink = func(event HostEvent) { events <- event }
	host, err := StartHost(context.Background(), spec)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(host.Stop)
	if _, err := host.ExecuteCommand(context.Background(), CommandRequest{RequestID: "crash", CommandID: "helper.crash"}); err == nil {
		t.Fatal("crashing command succeeded")
	}
	deadline := time.After(3 * time.Second)
	for {
		select {
		case event := <-events:
			if event.Type == "crashed" {
				if event.Error == "" {
					t.Fatal("crash event missing error")
				}
				if !strings.Contains(host.LastError(), "helper crashed") {
					t.Fatalf("stderr not captured: %q", host.LastError())
				}
				return
			}
		case <-deadline:
			t.Fatal("did not observe crash event")
		}
	}
}

func TestHostHooks(t *testing.T) {
	spec := withHelperEnv(t, helperSpec(t, ""), "block")
	host, err := StartHost(context.Background(), spec)
	if err != nil {
		t.Fatal(err)
	}
	result, err := host.RunHook(context.Background(), HookPreCommit, HookRequest{Path: "a.go"})
	if err != nil {
		t.Fatal(err)
	}
	if result.Allow || result.Message != "blocked by helper" {
		t.Fatalf("unexpected block result: %+v", result)
	}
	host.Stop()

	spec = withHelperEnv(t, helperSpec(t, ""), "save-transform")
	host, err = StartHost(context.Background(), spec)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(host.Stop)
	result, err = host.RunHook(context.Background(), HookSave, HookRequest{Path: "a.go", Content: "package main\n"})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Allow || result.Content == nil || !strings.Contains(*result.Content, "// formatted") {
		t.Fatalf("unexpected transform: %+v", result)
	}
	if _, err := host.RunHook(context.Background(), HookKind("unknown"), HookRequest{}); err == nil {
		t.Fatal("unknown hook accepted")
	}
}

func TestHostHookTimeout(t *testing.T) {
	spec := withHelperEnv(t, helperSpec(t, ""), "hook-timeout")
	spec.HookTimeout = 150 * time.Millisecond
	host, err := StartHost(context.Background(), spec)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(host.Stop)
	start := time.Now()
	if _, err := host.RunHook(context.Background(), HookOpen, HookRequest{Path: "a.go"}); err == nil {
		t.Fatal("hook should have timed out")
	} else if !strings.Contains(err.Error(), "timed out") {
		t.Fatalf("unexpected error: %v", err)
	}
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Fatalf("hook timeout took %s", elapsed)
	}
}

func TestHostInitializeFailure(t *testing.T) {
	spec := withHelperEnv(t, helperSpec(t, ""), "fail-init")
	if _, err := StartHost(context.Background(), spec); err == nil {
		t.Fatal("failed initialize accepted")
	}
	if _, err := StartHost(context.Background(), HostSpec{}); err == nil {
		t.Fatal("empty spec accepted")
	}
}

func TestManagerLifecycle(t *testing.T) {
	manager := NewHostManager(nil)
	spec := withHelperEnv(t, helperSpec(t, ""), "")
	host, err := manager.Ensure(context.Background(), spec)
	if err != nil {
		t.Fatal(err)
	}
	if again, err := manager.Ensure(context.Background(), spec); err != nil || again != host {
		t.Fatalf("Ensure did not reuse host: %v", err)
	}
	if current, healthy := manager.Get("ws1", "helper.plugin"); current != host || !healthy {
		t.Fatal("Get did not find host")
	}
	manager.Stop("ws1", "helper.plugin")
	if _, ok := manager.Get("ws1", "helper.plugin"); ok {
		t.Fatal("host still registered")
	}

	host, err = manager.Ensure(context.Background(), spec)
	if err != nil {
		t.Fatal(err)
	}
	manager.StopWorkspace("ws1")
	if host.Healthy() {
		t.Fatal("StopWorkspace left host running")
	}

	host, err = manager.Ensure(context.Background(), spec)
	if err != nil {
		t.Fatal(err)
	}
	manager.StopPlugin("helper.plugin")
	if host.Healthy() {
		t.Fatal("StopPlugin left host running")
	}

	host, err = manager.Ensure(context.Background(), spec)
	if err != nil {
		t.Fatal(err)
	}
	manager.StopAll()
	if host.Healthy() {
		t.Fatal("StopAll left host running")
	}
}

func TestHostConcurrentCalls(t *testing.T) {
	spec := withHelperEnv(t, helperSpec(t, ""), "")
	host, err := StartHost(context.Background(), spec)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(host.Stop)
	var wg sync.WaitGroup
	errs := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			result, err := host.ExecuteCommand(context.Background(), CommandRequest{
				RequestID: fmt.Sprintf("r%d", index), CommandID: "helper.hello",
			})
			if err != nil {
				errs <- err
				return
			}
			if !strings.Contains(result.Output, "done:helper.hello") {
				errs <- fmt.Errorf("unexpected output %q", result.Output)
			}
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
}
