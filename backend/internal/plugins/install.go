package plugins

import (
	"archive/zip"
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
)

const (
	MaxPackageBytes = 64 << 20
	MaxPackageFiles = 2000
	MaxPackageDepth = 20
)

// Installer validates and stores plugin packages under Root.
type Installer struct {
	Root     string
	MaxBytes int64
	MaxFiles int
}

// Installed describes a successfully installed package.
type Installed struct {
	Manifest *Manifest
	Dir      string
	Files    int
	Bytes    int64
}

// NewInstaller creates an installer rooted at dir.
func NewInstaller(dir string) *Installer {
	return &Installer{Root: dir, MaxBytes: MaxPackageBytes, MaxFiles: MaxPackageFiles}
}

// PackageDir returns the canonical directory for a plugin version.
func (i *Installer) PackageDir(id, version string) string {
	return filepath.Join(i.Root, id, version)
}

// InstallDir copies a local package directory into the plugin store.
func (i *Installer) InstallDir(src string) (*Installed, error) {
	srcAbs, err := filepath.Abs(src)
	if err != nil {
		return nil, fmt.Errorf("source path: %w", err)
	}
	info, err := os.Stat(srcAbs)
	if err != nil || !info.IsDir() {
		return nil, fmt.Errorf("source %q is not a directory", src)
	}
	rootAbs, err := filepath.Abs(i.Root)
	if err != nil {
		return nil, err
	}
	if srcAbs == rootAbs || strings.HasPrefix(srcAbs, rootAbs+string(filepath.Separator)) {
		return nil, errors.New("source directory must be outside the plugin store")
	}
	if err := os.MkdirAll(i.Root, 0o755); err != nil {
		return nil, fmt.Errorf("create plugin store: %w", err)
	}
	staging, err := os.MkdirTemp(i.Root, ".staging-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(staging)
	files, bytes, err := i.copyTree(srcAbs, staging)
	if err != nil {
		return nil, err
	}
	installed, err := i.finish(staging)
	if err != nil {
		return nil, err
	}
	installed.Files, installed.Bytes = files, bytes
	return installed, nil
}

// InstallZip extracts a zip package and installs its manifest root. The
// manifest may be at the archive root or inside a single wrapper directory.
func (i *Installer) InstallZip(data []byte) (*Installed, error) {
	max := i.MaxBytes
	if max <= 0 {
		max = MaxPackageBytes
	}
	if int64(len(data)) > max {
		return nil, fmt.Errorf("package exceeds %d bytes", max)
	}
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, fmt.Errorf("invalid zip: %w", err)
	}
	if err := os.MkdirAll(i.Root, 0o755); err != nil {
		return nil, fmt.Errorf("create plugin store: %w", err)
	}
	staging, err := os.MkdirTemp(i.Root, ".staging-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(staging)

	maxFiles := i.MaxFiles
	if maxFiles <= 0 {
		maxFiles = MaxPackageFiles
	}
	seen := make(map[string]bool)
	var total int64
	var fileCount int
	for _, entry := range reader.File {
		name := entry.Name
		if name == "" || strings.ContainsRune(name, '\x00') || strings.Contains(name, "\\") {
			return nil, fmt.Errorf("zip entry %q has an invalid name", name)
		}
		if path.IsAbs(name) || strings.HasPrefix(name, "/") {
			return nil, fmt.Errorf("zip entry %q is absolute", name)
		}
		clean := path.Clean(name)
		if clean == "." {
			continue
		}
		if clean == ".." || strings.HasPrefix(clean, "../") {
			return nil, fmt.Errorf("zip entry %q escapes the package", name)
		}
		if len(strings.Split(clean, "/")) > MaxPackageDepth {
			return nil, fmt.Errorf("zip entry %q is nested too deeply", name)
		}
		if seen[clean] {
			return nil, fmt.Errorf("duplicate zip entry %q", name)
		}
		seen[clean] = true
		if entry.Mode()&os.ModeSymlink != 0 {
			return nil, fmt.Errorf("zip entry %q is a symlink", name)
		}
		target := filepath.Join(staging, filepath.FromSlash(clean))
		if entry.FileInfo().IsDir() || strings.HasSuffix(name, "/") {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return nil, err
			}
			continue
		}
		if !entry.Mode().IsRegular() {
			return nil, fmt.Errorf("zip entry %q is not a regular file", name)
		}
		fileCount++
		if fileCount > maxFiles {
			return nil, fmt.Errorf("package contains more than %d files", maxFiles)
		}
		total += int64(entry.UncompressedSize64)
		if total > max {
			return nil, fmt.Errorf("package expands beyond %d bytes", max)
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return nil, err
		}
		if err := extractZipFile(entry, target, max-total+int64(entry.UncompressedSize64)); err != nil {
			return nil, fmt.Errorf("extract %q: %w", name, err)
		}
	}

	pkgRoot, err := findPackageRoot(staging)
	if err != nil {
		return nil, err
	}
	installed, err := i.finish(pkgRoot)
	if err != nil {
		return nil, err
	}
	installed.Files, installed.Bytes = fileCount, total
	return installed, nil
}

func extractZipFile(entry *zip.File, target string, limit int64) error {
	reader, err := entry.Open()
	if err != nil {
		return err
	}
	defer reader.Close()
	mode := os.FileMode(0o644)
	if entry.Mode()&0o111 != 0 {
		mode = 0o755
	}
	file, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	if limit <= 0 {
		limit = MaxPackageBytes
	}
	written, err := io.Copy(file, io.LimitReader(reader, limit+1))
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if written > limit {
		return errors.New("entry expands beyond the package limit")
	}
	return closeErr
}

func findPackageRoot(staging string) (string, error) {
	if _, err := os.Stat(filepath.Join(staging, ManifestFileName)); err == nil {
		return staging, nil
	}
	entries, err := os.ReadDir(staging)
	if err != nil {
		return "", err
	}
	if len(entries) != 1 || !entries[0].IsDir() {
		return "", fmt.Errorf("%s must be at the package root or inside a single wrapper directory", ManifestFileName)
	}
	root := filepath.Join(staging, entries[0].Name())
	if _, err := os.Stat(filepath.Join(root, ManifestFileName)); err != nil {
		return "", fmt.Errorf("%s not found in package", ManifestFileName)
	}
	return root, nil
}

func (i *Installer) copyTree(src, dst string) (int, int64, error) {
	maxBytes := i.MaxBytes
	if maxBytes <= 0 {
		maxBytes = MaxPackageBytes
	}
	maxFiles := i.MaxFiles
	if maxFiles <= 0 {
		maxFiles = MaxPackageFiles
	}
	var files int
	var total int64
	err := filepath.WalkDir(src, func(current string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(src, current)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}
		if len(strings.Split(filepath.ToSlash(rel), "/")) > MaxPackageDepth {
			return fmt.Errorf("path %q is nested too deeply", rel)
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("path %q is a symlink", rel)
		}
		target := filepath.Join(dst, rel)
		if entry.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("path %q is not a regular file", rel)
		}
		files++
		if files > maxFiles {
			return fmt.Errorf("package contains more than %d files", maxFiles)
		}
		if info.Size() > maxBytes-total {
			return fmt.Errorf("package expands beyond %d bytes", maxBytes)
		}
		total += info.Size()
		mode := os.FileMode(0o644)
		if info.Mode()&0o111 != 0 {
			mode = 0o755
		}
		return copyFile(current, target, mode, maxBytes-total+info.Size())
	})
	return files, total, err
}

func copyFile(src, dst string, mode os.FileMode, limit int64) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	written, err := io.Copy(out, io.LimitReader(in, limit+1))
	closeErr := out.Close()
	if err != nil {
		return err
	}
	if written > limit {
		return errors.New("file exceeds the package limit")
	}
	return closeErr
}

func (i *Installer) finish(staging string) (*Installed, error) {
	manifest, err := LoadManifest(staging)
	if err != nil {
		return nil, err
	}
	dest := i.PackageDir(manifest.ID, manifest.Version)
	parent := filepath.Dir(dest)
	if err := os.MkdirAll(parent, 0o755); err != nil {
		return nil, err
	}
	var backup string
	if _, err := os.Stat(dest); err == nil {
		backup = dest + ".old-" + randomSuffix()
		if err := os.Rename(dest, backup); err != nil {
			return nil, fmt.Errorf("replace existing package: %w", err)
		}
	}
	if err := os.Rename(staging, dest); err != nil {
		if backup != "" {
			_ = os.Rename(backup, dest)
		}
		return nil, fmt.Errorf("install package: %w", err)
	}
	if backup != "" {
		_ = os.RemoveAll(backup)
	}
	return &Installed{Manifest: manifest, Dir: dest}, nil
}

// RemoveVersion deletes one installed version.
func (i *Installer) RemoveVersion(id, version string) error {
	if err := safeSegment(id); err != nil {
		return err
	}
	if err := safeSegment(version); err != nil {
		return err
	}
	return os.RemoveAll(i.PackageDir(id, version))
}

// RemoveAll deletes every installed version of a plugin.
func (i *Installer) RemoveAll(id string) error {
	if err := safeSegment(id); err != nil {
		return err
	}
	return os.RemoveAll(filepath.Join(i.Root, id))
}

func safeSegment(value string) error {
	if value == "" || value == "." || value == ".." || strings.ContainsAny(value, `/\`) || strings.ContainsRune(value, '\x00') {
		return fmt.Errorf("invalid path segment %q", value)
	}
	return nil
}

func randomSuffix() string {
	var buf [6]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return fmt.Sprintf("%d", os.Getpid())
	}
	return hex.EncodeToString(buf[:])
}
