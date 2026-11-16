package archiveextract

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"hash/crc32"
	"io"
	"testing"
)

// fakeReader serves an in-memory archive through the ranged-read seam and
// counts round trips, so the reader tests need no SSH server.
type fakeReader struct {
	data  []byte
	calls int
	err   error
}

func (f *fakeReader) ReadRange(_ context.Context, off int64, length int) ([]byte, error) {
	f.calls++
	if f.err != nil {
		return nil, f.err
	}
	if off < 0 || off+int64(length) > int64(len(f.data)) {
		return nil, io.ErrUnexpectedEOF
	}
	out := make([]byte, length)
	copy(out, f.data[off:off+int64(length)])
	return out, nil
}

func (f *fakeReader) ReadRangeTo(_ context.Context, w io.Writer, off, length int64) (int64, error) {
	f.calls++
	if f.err != nil {
		return 0, f.err
	}
	if off < 0 || off+length > int64(len(f.data)) {
		return 0, io.ErrUnexpectedEOF
	}
	n, err := w.Write(f.data[off : off+length])
	return int64(n), err
}

func TestReaderAtContract(t *testing.T) {
	data := []byte("0123456789")
	r := NewReaderAt(context.Background(), &fakeReader{data: data}, int64(len(data)))

	buf := make([]byte, 4)
	if n, err := r.ReadAt(buf, 0); err != nil || n != 4 || string(buf) != "0123" {
		t.Fatalf("ReadAt(0,4) = %q, %v", buf[:n], err)
	}
	if n, err := r.ReadAt(buf, 8); err != io.EOF || n != 2 || string(buf[:n]) != "89" {
		t.Fatalf("ReadAt(8,4) = %q, %v; want 2 bytes and EOF", buf[:n], err)
	}
	if n, err := r.ReadAt(buf, 10); err != io.EOF || n != 0 {
		t.Fatalf("ReadAt(10,4) = %d, %v; want 0, EOF", n, err)
	}
	if n, err := r.ReadAt(buf, 99); err != io.EOF || n != 0 {
		t.Fatalf("ReadAt(99,4) = %d, %v; want 0, EOF", n, err)
	}
	if n, err := r.ReadAt(nil, 0); err != nil || n != 0 {
		t.Fatalf("ReadAt(nil) = %d, %v; want 0, nil", n, err)
	}
	if _, err := r.ReadAt(buf, -1); err == nil {
		t.Fatal("negative offset must fail")
	}
}

func TestReaderAtPropagatesErrors(t *testing.T) {
	boom := errors.New("boom")
	r := NewReaderAt(context.Background(), &fakeReader{data: make([]byte, 10), err: boom}, 10)
	if _, err := r.ReadAt(make([]byte, 2), 0); !errors.Is(err, boom) {
		t.Fatalf("err = %v, want boom", err)
	}
}

func TestWindowReturnsTheSameBytes(t *testing.T) {
	data := buildZip(t, map[string]string{"a.txt": "alpha", "dir/b.txt": "beta", "c.bin": "bom"})
	want := readAll(t, NewReaderAt(context.Background(), &fakeReader{data: data}, int64(len(data))), int64(len(data)))
	for _, window := range []int{8, 16, 64, 1024, 1 << 20} {
		base := NewReaderAt(context.Background(), &fakeReader{data: data}, int64(len(data)))
		got := readAll(t, NewWindowReaderAt(base, window), int64(len(data)))
		if !bytes.Equal(got, want) {
			t.Fatalf("window %d returned %q, want %q", window, got, want)
		}
	}
}

func TestWindowCollapsesRoundTrips(t *testing.T) {
	data := buildZip(t, map[string]string{
		"a.txt": "alpha", "b.txt": "bravo", "c.txt": "charlie", "d.txt": "delta",
	})
	plain := &fakeReader{data: data}
	readAll(t, NewReaderAt(context.Background(), plain, int64(len(data))), int64(len(data)))

	wrapped := &fakeReader{data: data}
	base := NewReaderAt(context.Background(), wrapped, int64(len(data)))
	readAll(t, NewWindowReaderAt(base, 1<<20), int64(len(data)))

	if wrapped.calls >= plain.calls {
		t.Fatalf("window made %d round trips, plain made %d — the window should collapse them", wrapped.calls, plain.calls)
	}
	t.Logf("round trips: plain=%d windowed=%d", plain.calls, wrapped.calls)
}

func TestOpenRejectsNonZip(t *testing.T) {
	junk := []byte("this is definitely not a zip archive")
	if _, err := Open(context.Background(), &fakeReader{data: junk}, int64(len(junk))); !errors.Is(err, ErrUnsupportedArchive) {
		t.Fatalf("err = %v, want ErrUnsupportedArchive", err)
	}
	small := []byte("PK\x03\x04")
	if _, err := Open(context.Background(), &fakeReader{data: small}, int64(len(small))); !errors.Is(err, ErrUnsupportedArchive) {
		t.Fatalf("tiny archive err = %v, want ErrUnsupportedArchive", err)
	}
	if err := Sniff(context.Background(), &fakeReader{data: junk}); !errors.Is(err, ErrUnsupportedArchive) {
		t.Fatalf("Sniff err = %v, want ErrUnsupportedArchive", err)
	}
	if err := Sniff(context.Background(), &fakeReader{data: buildZip(t, map[string]string{"a": "b"})}); err != nil {
		t.Fatalf("Sniff rejected a real zip: %v", err)
	}
}

func TestOpenReadsMembers(t *testing.T) {
	data := buildZip(t, map[string]string{"a.txt": "alpha", "dir/b.txt": "beta"})
	zr, err := Open(context.Background(), &fakeReader{data: data}, int64(len(data)))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	seen := map[string]string{}
	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("open %s: %v", f.Name, err)
		}
		b, err := io.ReadAll(rc)
		_ = rc.Close()
		if err != nil {
			t.Fatalf("read %s: %v", f.Name, err)
		}
		seen[f.Name] = string(b)
	}
	if seen["a.txt"] != "alpha" || seen["dir/b.txt"] != "beta" {
		t.Fatalf("members = %v", seen)
	}
}

func TestCheckSupported(t *testing.T) {
	encrypted := &zip.File{FileHeader: zip.FileHeader{Name: "x", Method: zip.Deflate, Flags: 0x1}}
	if err := CheckSupported(encrypted); !errors.Is(err, ErrUnsupportedArchive) {
		t.Fatalf("encrypted err = %v", err)
	}
	weird := &zip.File{FileHeader: zip.FileHeader{Name: "x", Method: 99}}
	if err := CheckSupported(weird); !errors.Is(err, ErrUnsupportedArchive) {
		t.Fatalf("method err = %v", err)
	}
	ok := &zip.File{FileHeader: zip.FileHeader{Name: "x", Method: zip.Deflate}}
	if err := CheckSupported(ok); err != nil {
		t.Fatalf("deflate rejected: %v", err)
	}
}

func TestOpenZip64(t *testing.T) {
	data := buildZip64(t, "big.txt", []byte("zip64 payload"))
	zr, err := Open(context.Background(), &fakeReader{data: data}, int64(len(data)))
	if err != nil {
		t.Fatalf("Open zip64: %v", err)
	}
	if len(zr.File) != 1 || zr.File[0].Name != "big.txt" {
		t.Fatalf("zip64 files = %v", zr.File)
	}
	rc, err := zr.File[0].Open()
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	b, err := io.ReadAll(rc)
	_ = rc.Close()
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if string(b) != "zip64 payload" {
		t.Fatalf("content = %q", b)
	}
}

func readAll(t *testing.T, ra io.ReaderAt, size int64) []byte {
	t.Helper()
	zr, err := zip.NewReader(ra, size)
	if err != nil {
		t.Fatalf("zip.NewReader: %v", err)
	}
	var out bytes.Buffer
	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("open %s: %v", f.Name, err)
		}
		if _, err := io.Copy(&out, rc); err != nil {
			_ = rc.Close()
			t.Fatalf("copy %s: %v", f.Name, err)
		}
		_ = rc.Close()
	}
	return out.Bytes()
}

func buildZip(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	// Deterministic order: map iteration is not.
	for _, name := range sortedKeys(files) {
		fw, err := w.Create(name)
		if err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		if _, err := fw.Write([]byte(files[name])); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatalf("close zip: %v", err)
	}
	return buf.Bytes()
}

func sortedKeys(m map[string]string) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	for i := 1; i < len(keys); i++ {
		for j := i; j > 0 && keys[j] < keys[j-1]; j-- {
			keys[j], keys[j-1] = keys[j-1], keys[j]
		}
	}
	return keys
}

// buildZip64 hand-assembles a zip64 archive (the Go writer only emits
// zip64 records when sizes require them), so the reader is exercised
// against the format beyond what a small archive would produce.
func buildZip64(t *testing.T, name string, data []byte) []byte {
	t.Helper()
	var out bytes.Buffer
	put := func(v any) {
		if err := binary.Write(&out, binary.LittleEndian, v); err != nil {
			t.Fatalf("binary.Write: %v", err)
		}
	}
	extraLen := uint16(4 + 16)
	writeExtra := func() {
		put(uint16(0x0001))
		put(uint16(16))
		put(uint64(len(data)))
		put(uint64(len(data)))
	}
	crc := crc32.ChecksumIEEE(data)

	put(uint32(0x04034b50))
	put(uint16(45))
	put(uint16(0))
	put(uint16(zip.Store))
	put(uint16(0))
	put(uint16(0))
	put(crc)
	put(uint32(0xFFFFFFFF))
	put(uint32(0xFFFFFFFF))
	put(uint16(len(name)))
	put(extraLen)
	out.WriteString(name)
	writeExtra()
	out.Write(data)
	cdStart := out.Len()

	put(uint32(0x02014b50))
	put(uint16(45))
	put(uint16(45))
	put(uint16(0))
	put(uint16(zip.Store))
	put(uint16(0))
	put(uint16(0))
	put(crc)
	put(uint32(0xFFFFFFFF))
	put(uint32(0xFFFFFFFF))
	put(uint16(len(name)))
	put(extraLen)
	put(uint16(0))
	put(uint16(0))
	put(uint16(0))
	put(uint32(0))
	put(uint32(0))
	out.WriteString(name)
	writeExtra()
	cdSize := out.Len() - cdStart

	z64Start := out.Len()
	put(uint32(0x06064b50))
	put(uint64(44))
	put(uint16(45))
	put(uint16(45))
	put(uint32(0))
	put(uint32(0))
	put(uint64(1))
	put(uint64(1))
	put(uint64(cdSize))
	put(uint64(cdStart))

	put(uint32(0x07064b50))
	put(uint32(0))
	put(uint64(z64Start))
	put(uint32(1))

	put(uint32(0x06054b50))
	put(uint16(0))
	put(uint16(0))
	put(uint16(0xFFFF))
	put(uint16(0xFFFF))
	put(uint32(0xFFFFFFFF))
	put(uint32(0xFFFFFFFF))
	put(uint16(0))
	return out.Bytes()
}
