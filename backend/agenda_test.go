package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

// makeDirUnwritable drops the write bit on dir so that writes inside it
// fail, and restores it when the test ends (t.TempDir()'s own cleanup would
// otherwise be unable to delete the directory). Skips the calling test when
// running as root, where the mode bits are simply not enforced and the
// failure being exercised would never happen.
func makeDirUnwritable(t *testing.T, dir string) {
	t.Helper()
	if os.Geteuid() == 0 {
		t.Skip("running as root: mode 0500 does not stop root from writing, so a write failure cannot be simulated")
	}
	if err := os.Chmod(dir, 0o500); err != nil {
		t.Fatalf("chmod %s: %v", dir, err)
	}
	t.Cleanup(func() { _ = os.Chmod(dir, 0o700) })
}

func TestAgendaLoadSeedsDefaultWhenFileMissing(t *testing.T) {
	path := filepath.Join(t.TempDir(), "agenda.json")
	a := NewAgenda(path)

	if err := a.Load(); err != nil {
		t.Fatalf("Load: %v", err)
	}

	got := a.List()
	want := defaultAgendaEvents()
	if len(got) != len(want) {
		t.Fatalf("expected %d seeded events, got %d", len(want), len(got))
	}
	if got[0].Title != want[0].Title {
		t.Fatalf("expected first event %q, got %q", want[0].Title, got[0].Title)
	}

	if _, err := os.Stat(path); err != nil {
		t.Fatalf("expected seed to be written to disk: %v", err)
	}
}

func TestAgendaLoadReadsExistingFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "agenda.json")
	existing := []AgendaEvent{
		{Title: "Custom Event", Subtitle: "sub", Icon: "mdi-star", IconColor: "blue", Color: "#FFFFFF", ColorDark: "#000000", Date: "2026-01-01", Time: "9:00 - 10:00"},
	}
	data, err := json.Marshal(existing)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatalf("write fixture: %v", err)
	}

	a := NewAgenda(path)
	if err := a.Load(); err != nil {
		t.Fatalf("Load: %v", err)
	}

	got := a.List()
	if len(got) != 1 || got[0].Title != "Custom Event" {
		t.Fatalf("expected the file's own event to be loaded, got %+v", got)
	}
}

func TestAgendaLoadSeedWriteFailureIsNotFatal(t *testing.T) {
	dir := t.TempDir()
	makeDirUnwritable(t, dir)
	path := filepath.Join(dir, "agenda.json")

	a := NewAgenda(path)
	if err := a.Load(); err != nil {
		t.Fatalf("expected a failed seed write to be non-fatal, got: %v", err)
	}

	got := a.List()
	want := defaultAgendaEvents()
	if len(got) != len(want) || got[0].Title != want[0].Title {
		t.Fatalf("expected the built-in defaults to still be served from memory, got %+v", got)
	}

	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expected no agenda file to have been written, got err=%v", err)
	}
}

func TestAgendaLoadCorruptFileStaysFatal(t *testing.T) {
	path := filepath.Join(t.TempDir(), "agenda.json")
	if err := os.WriteFile(path, []byte("{not json"), 0o644); err != nil {
		t.Fatalf("write fixture: %v", err)
	}

	// An existing-but-unparseable file must keep failing loudly: falling
	// back to the defaults here would mean quietly serving them over real
	// schedule data, and the next save would overwrite the very file
	// someone still has a chance to repair.
	a := NewAgenda(path)
	if err := a.Load(); err == nil {
		t.Fatalf("expected Load to fail on a corrupt agenda file")
	}
}

func TestAgendaLoadRejectsSemanticallyInvalidOnDiskFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "agenda.json")
	// Valid JSON, but the color fails validateAgendaEvent's hex-code check.
	// A hand-edit or a bug elsewhere could produce exactly this: well-formed
	// JSON that Unmarshal happily accepts but that isn't a legal event.
	invalid := []AgendaEvent{
		{Title: "Bad Color", Subtitle: "sub", Icon: "mdi-star", IconColor: "blue", Color: "not-a-hex-code", ColorDark: "#000000", Date: "2026-01-01", Time: "9:00 - 10:00"},
	}
	data, err := json.Marshal(invalid)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatalf("write fixture: %v", err)
	}

	a := NewAgenda(path)
	if err := a.Load(); err == nil {
		t.Fatalf("expected Load to fail on a semantically invalid agenda file")
	}

	// a is a fresh Agenda that was never successfully loaded, so its events
	// must still be the zero-value empty slice -- Load must not have
	// mutated it on the way to returning an error.
	if got := a.List(); len(got) != 0 {
		t.Fatalf("expected a.events to remain untouched after a rejected Load, got %+v", got)
	}
}

func TestTimeRangePatternRejectsOutOfRangeValues(t *testing.T) {
	bad := []string{
		"25:00 - 26:00", // hour out of range on both sides
		"99:99 - 05:00", // the original shape-only regex accepted this
		"24:00 - 00:00", // hours only go up to 23
		"9:60 - 10:00",  // minutes only go up to 59
		"9:00 - 10:60",
	}
	for _, tr := range bad {
		if timeRangePattern.MatchString(tr) {
			t.Errorf("expected %q to be rejected", tr)
		}
	}
}

func TestTimeRangePatternAcceptsEveryPreviouslyValidFormat(t *testing.T) {
	good := []string{
		"9:00 - 10:00",  // single-digit hour, as used throughout defaultAgendaEvents
		"09:00 - 10:00", // zero-padded hour
		"20:00 - 08:00", // overnight range, as used by the seed data
		"0:00 - 23:59",  // edges of the valid hour range
		"23:59 - 00:00",
	}
	for _, tr := range good {
		if !timeRangePattern.MatchString(tr) {
			t.Errorf("expected %q to still be accepted", tr)
		}
	}

	for _, e := range defaultAgendaEvents() {
		if !timeRangePattern.MatchString(e.Time) {
			t.Errorf("expected seed event %q's time %q to still be accepted", e.Title, e.Time)
		}
	}
}

func validAgendaEventFixture() AgendaEvent {
	return AgendaEvent{Title: "T", Subtitle: "S", Icon: "mdi-star", IconColor: "blue", Color: "#FFFFFF", ColorDark: "#000000", Date: "2026-01-01", Time: "9:00 - 10:00"}
}

func TestAgendaReplaceValidation(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(e AgendaEvent) AgendaEvent
	}{
		{"empty title", func(e AgendaEvent) AgendaEvent { e.Title = ""; return e }},
		{"bad date", func(e AgendaEvent) AgendaEvent { e.Date = "18-08-2025"; return e }},
		{"bad time", func(e AgendaEvent) AgendaEvent { e.Time = "9am to 10am"; return e }},
		{"out-of-range time", func(e AgendaEvent) AgendaEvent { e.Time = "25:00 - 26:00"; return e }},
		{"empty icon", func(e AgendaEvent) AgendaEvent { e.Icon = ""; return e }},
		{"empty icon color", func(e AgendaEvent) AgendaEvent { e.IconColor = ""; return e }},
		{"bad color", func(e AgendaEvent) AgendaEvent { e.Color = "pink"; return e }},
		{"bad color dark", func(e AgendaEvent) AgendaEvent { e.ColorDark = "not-hex"; return e }},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			a := NewAgenda(filepath.Join(t.TempDir(), "agenda.json"))
			err := a.Replace([]AgendaEvent{tt.mutate(validAgendaEventFixture())})
			if err == nil {
				t.Fatalf("expected an error, got nil")
			}
			// The HTTP layer answers 400 vs 500 off this distinction, so
			// bad input has to arrive typed as a validation failure.
			var invalid *agendaValidationError
			if !errors.As(err, &invalid) {
				t.Fatalf("expected an *agendaValidationError, got %T: %v", err, err)
			}
		})
	}
}

func TestAgendaReplaceWriteFailureIsNotAValidationError(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "agenda.json")
	a := NewAgenda(path)

	good := []AgendaEvent{validAgendaEventFixture()}
	if err := a.Replace(good); err != nil {
		t.Fatalf("Replace(good): %v", err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading agenda file: %v", err)
	}

	makeDirUnwritable(t, dir)

	next := []AgendaEvent{validAgendaEventFixture()}
	next[0].Title = "Should Not Persist"
	err = a.Replace(next)
	if err == nil {
		t.Fatalf("expected Replace to fail when the agenda directory is not writable")
	}
	var invalid *agendaValidationError
	if errors.As(err, &invalid) {
		t.Fatalf("expected a server-side error so the handler answers 500, got a validation error: %v", err)
	}

	if got := a.List(); len(got) != 1 || got[0].Title != validAgendaEventFixture().Title {
		t.Fatalf("expected in-memory state unchanged after a failed write, got %+v", got)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading agenda file after the failed write: %v", err)
	}
	if string(after) != string(before) {
		t.Fatalf("expected the on-disk file unchanged after a failed write, before=%s after=%s", before, after)
	}
}

func TestAgendaReplacePersistsToDisk(t *testing.T) {
	path := filepath.Join(t.TempDir(), "agenda.json")
	a := NewAgenda(path)

	events := []AgendaEvent{
		{Title: "Persisted", Subtitle: "sub", Icon: "mdi-star", IconColor: "blue", Color: "#FFFFFF", ColorDark: "#000000", Date: "2026-01-01", Time: "9:00 - 10:00"},
	}
	if err := a.Replace(events); err != nil {
		t.Fatalf("Replace: %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading persisted file: %v", err)
	}
	var onDisk []AgendaEvent
	if err := json.Unmarshal(data, &onDisk); err != nil {
		t.Fatalf("unmarshal persisted file: %v", err)
	}
	if len(onDisk) != 1 || onDisk[0].Title != "Persisted" {
		t.Fatalf("expected the new event on disk, got %+v", onDisk)
	}
}

func TestAgendaReplaceRejectsWithoutMutatingState(t *testing.T) {
	a := NewAgenda(filepath.Join(t.TempDir(), "agenda.json"))
	good := []AgendaEvent{
		{Title: "Good", Subtitle: "sub", Icon: "mdi-star", IconColor: "blue", Color: "#FFFFFF", ColorDark: "#000000", Date: "2026-01-01", Time: "9:00 - 10:00"},
	}
	if err := a.Replace(good); err != nil {
		t.Fatalf("Replace(good): %v", err)
	}

	bad := []AgendaEvent{{Title: ""}}
	if err := a.Replace(bad); err == nil {
		t.Fatalf("expected Replace(bad) to fail")
	}

	got := a.List()
	if len(got) != 1 || got[0].Title != "Good" {
		t.Fatalf("expected state to remain at the last good Replace, got %+v", got)
	}
}

func TestAgendaConcurrentAccess(t *testing.T) {
	path := filepath.Join(t.TempDir(), "agenda.json")
	a := NewAgenda(path)
	if err := a.Load(); err != nil {
		t.Fatalf("Load: %v", err)
	}

	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(2)
		idx := i
		go func() {
			defer wg.Done()
			_ = a.List()
		}()
		go func() {
			defer wg.Done()
			// Each goroutine writes a distinguishable payload with its index in the title
			_ = a.Replace([]AgendaEvent{
				{Title: fmt.Sprintf("Event%d", idx), Subtitle: "sub", Icon: "mdi-star", IconColor: "blue", Color: "#FFFFFF", ColorDark: "#000000", Date: "2026-01-01", Time: "9:00 - 10:00"},
			})
		}()
	}
	wg.Wait()

	// Verify that in-memory state matches what's on disk.
	// This catches the race where they could diverge.
	inMemory := a.List()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading agenda file after concurrent access: %v", err)
	}
	var onDisk []AgendaEvent
	if err := json.Unmarshal(data, &onDisk); err != nil {
		t.Fatalf("unmarshaling agenda file after concurrent access: %v", err)
	}

	if len(inMemory) != len(onDisk) {
		t.Fatalf("state mismatch: in-memory has %d events, disk has %d events", len(inMemory), len(onDisk))
	}
	for i, mem := range inMemory {
		disk := onDisk[i]
		if mem.Title != disk.Title || mem.Subtitle != disk.Subtitle || mem.Icon != disk.Icon ||
			mem.IconColor != disk.IconColor || mem.Color != disk.Color || mem.ColorDark != disk.ColorDark ||
			mem.Date != disk.Date || mem.Time != disk.Time {
			t.Fatalf("state mismatch at event %d: in-memory %+v, disk %+v", i, mem, disk)
		}
	}
}
