package plugins

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func packageFiles(t *testing.T) map[string]string {
	t.Helper()
	data, err := json.Marshal(validManifest())
	if err != nil {
		t.Fatal(err)
	}
	return map[string]string{
		ManifestFileName: string(data),
		"bin/demo":       "#!/bin/sh\nexit 0\n",
		"bin/lsp":        "#!/bin/sh\nexit 0\n",
		"bin/dap":        "#!/bin/sh\nexit 0\n",
	}
}

func writePackageDir(t *testing.T, files map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	for name, body := range files {
		full := filepath.Join(dir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		mode := os.FileMode(0o644)
		if strings.HasPrefix(name, "bin/") {
			mode = 0o755
		}
		if err := os.WriteFile(full, []byte(body), mode); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func packageZip(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	writer := zip.NewWriter(&buf)
	for name, body := range files {
		header := &zip.FileHeader{Name: name, Method: zip.Deflate}
		header.SetMode(0o644)
		if strings.HasPrefix(name, "bin/") {
			header.SetMode(0o755)
		}
		entry, err := writer.CreateHeader(header)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestInstallDirAndReinstall(t *testing.T) {
	src := writePackageDir(t, packageFiles(t))
	installer := NewInstaller(filepath.Join(t.TempDir(), "plugins"))
	installed, err := installer.InstallDir(src)
	if err != nil {
		t.Fatal(err)
	}
	if installed.Manifest.ID != "demo.plugin" || installed.Files != 4 {
		t.Fatalf("unexpected install: %+v", installed)
	}
	dest := installer.PackageDir("demo.plugin", "1.2.3")
	if installed.Dir != dest {
		t.Fatalf("dir = %q, want %q", installed.Dir, dest)
	}
	dirInfo, err := os.Stat(dest)
	if err != nil {
		t.Fatal(err)
	}
	if dirInfo.Mode().Perm() != 0o755 {
		t.Fatalf("package dir mode = %v, want 0755", dirInfo.Mode().Perm())
	}
	info, err := os.Stat(filepath.Join(dest, "bin", "demo"))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode()&0o111 == 0 {
		t.Fatal("executable bit was not preserved")
	}
	if _, err := LoadManifest(dest); err != nil {
		t.Fatalf("installed package is invalid: %v", err)
	}

	// Reinstalling the same version replaces the directory atomically.
	if err := os.WriteFile(filepath.Join(src, "marker"), []byte("new"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := installer.InstallDir(src); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dest, "marker")); err != nil {
		t.Fatalf("reinstall did not replace package: %v", err)
	}
	entries, err := os.ReadDir(dest)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if strings.Contains(entry.Name(), ".old-") || strings.HasPrefix(entry.Name(), ".staging-") {
			t.Fatalf("leftover entry %q", entry.Name())
		}
	}
}

func TestInstallDirRejectsBadPackages(t *testing.T) {
	files := packageFiles(t)
	installer := NewInstaller(filepath.Join(t.TempDir(), "plugins"))

	missingManifest := writePackageDir(t, map[string]string{"README.md": "x"})
	if _, err := installer.InstallDir(missingManifest); err == nil {
		t.Fatal("missing manifest accepted")
	}

	linkDir := writePackageDir(t, files)
	target := filepath.Join(t.TempDir(), "outside")
	if err := os.WriteFile(target, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, filepath.Join(linkDir, "extra-link")); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if _, err := installer.InstallDir(linkDir); err == nil {
		t.Fatal("symlink package accepted")
	}

	if err := os.MkdirAll(installer.Root, 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := installer.InstallDir(filepath.Join(installer.Root, "nested")); err == nil {
		t.Fatal("source inside plugin store accepted")
	}

	limited := NewInstaller(filepath.Join(t.TempDir(), "plugins"))
	limited.MaxFiles = 2
	if _, err := limited.InstallDir(writePackageDir(t, files)); err == nil {
		t.Fatal("file limit not enforced")
	}
	limited = NewInstaller(filepath.Join(t.TempDir(), "plugins"))
	limited.MaxBytes = 10
	if _, err := limited.InstallDir(writePackageDir(t, files)); err == nil {
		t.Fatal("byte limit not enforced")
	}
}

func TestInstallZipRootAndWrapper(t *testing.T) {
	for name, prefix := range map[string]string{"root": "", "wrapper": "demo/"} {
		t.Run(name, func(t *testing.T) {
			files := packageFiles(t)
			prefixed := make(map[string]string, len(files))
			for file, body := range files {
				prefixed[prefix+file] = body
			}
			installer := NewInstaller(filepath.Join(t.TempDir(), "plugins"))
			installed, err := installer.InstallZip(packageZip(t, prefixed))
			if err != nil {
				t.Fatalf("install zip: %v", err)
			}
			dest := installer.PackageDir("demo.plugin", "1.2.3")
			if installed.Dir != dest {
				t.Fatalf("dir = %q", installed.Dir)
			}
			if _, err := os.Stat(filepath.Join(dest, ManifestFileName)); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestInstallZipRejectsUnsafeEntries(t *testing.T) {
	base := packageFiles(t)
	cases := map[string]map[string]string{
		"traversal": {"../evil": "x"},
		"absolute":  {"/etc/passwd": "x"},
		"backslash": {`bin\evil`: "x"},
	}
	for name, extra := range cases {
		files := make(map[string]string, len(base)+len(extra))
		for file, body := range base {
			files[file] = body
		}
		for file, body := range extra {
			files[file] = body
		}
		if _, err := NewInstaller(filepath.Join(t.TempDir(), "plugins")).InstallZip(packageZip(t, files)); err == nil {
			t.Fatalf("%s: unsafe zip accepted", name)
		}
	}
	if _, err := NewInstaller(filepath.Join(t.TempDir(), "plugins")).InstallZip(packageZip(t, map[string]string{"README.md": "x"})); err == nil {
		t.Fatal("missing manifest zip accepted")
	}
	if _, err := NewInstaller(t.TempDir()).InstallZip([]byte("not a zip")); err == nil {
		t.Fatal("invalid zip accepted")
	}
	installer := NewInstaller(filepath.Join(t.TempDir(), "plugins"))
	installer.MaxBytes = 20
	if _, err := installer.InstallZip(packageZip(t, base)); err == nil {
		t.Fatal("zip byte limit not enforced")
	}
	installer = NewInstaller(filepath.Join(t.TempDir(), "plugins"))
	installer.MaxFiles = 1
	if _, err := installer.InstallZip(packageZip(t, base)); err == nil {
		t.Fatal("zip file limit not enforced")
	}
}

func TestInstallZipRejectsSymlinkEntries(t *testing.T) {
	var buf bytes.Buffer
	writer := zip.NewWriter(&buf)
	header := &zip.FileHeader{Name: ManifestFileName}
	entry, err := writer.CreateHeader(header)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := entry.Write([]byte("{}")); err != nil {
		t.Fatal(err)
	}
	link := &zip.FileHeader{Name: "bin/link"}
	link.SetMode(os.ModeSymlink | 0o777)
	linkEntry, err := writer.CreateHeader(link)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := linkEntry.Write([]byte("/etc/passwd")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := NewInstaller(filepath.Join(t.TempDir(), "plugins")).InstallZip(buf.Bytes()); err == nil {
		t.Fatal("symlink zip entry accepted")
	}
}

func TestRemoveInstalledPackage(t *testing.T) {
	src := writePackageDir(t, packageFiles(t))
	installer := NewInstaller(filepath.Join(t.TempDir(), "plugins"))
	if _, err := installer.InstallDir(src); err != nil {
		t.Fatal(err)
	}
	dest := installer.PackageDir("demo.plugin", "1.2.3")
	if err := installer.RemoveVersion("demo.plugin", "1.2.3"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(dest); !os.IsNotExist(err) {
		t.Fatalf("version dir still exists: %v", err)
	}
	if _, err := installer.InstallDir(src); err != nil {
		t.Fatal(err)
	}
	if err := installer.RemoveAll("demo.plugin"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(installer.Root, "demo.plugin")); !os.IsNotExist(err) {
		t.Fatalf("plugin dir still exists: %v", err)
	}
	if err := installer.RemoveVersion("../x", "1.0.0"); err == nil {
		t.Fatal("traversal id accepted")
	}
	if err := installer.RemoveVersion("demo.plugin", ".."); err == nil {
		t.Fatal("traversal version accepted")
	}
	if err := installer.RemoveAll(""); err == nil {
		t.Fatal("empty id accepted")
	}
}

func TestInstallerRoundTripManifest(t *testing.T) {
	files := packageFiles(t)
	delete(files, "bin/dap")
	installer := NewInstaller(filepath.Join(t.TempDir(), "plugins"))
	if _, err := installer.InstallZip(packageZip(t, files)); err == nil {
		t.Fatal("package missing debugger server accepted")
	}
}
