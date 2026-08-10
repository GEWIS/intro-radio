package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

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
		})
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
