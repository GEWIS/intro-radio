package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"
)

// AgendaEvent is one entry on the public "Radio Schedule." Field names and
// JSON tags match what used to be the frontend's hardcoded
// src/assets/schedule.json 1:1, so UpcomingEvents.vue's existing
// grouping/filtering logic needs no changes once it reads this shape from
// the API instead of a bundled file.
type AgendaEvent struct {
	Title     string `json:"title"`
	Subtitle  string `json:"subtitle"`
	Icon      string `json:"icon"`
	IconColor string `json:"iconColor"`
	Color     string `json:"color"`
	ColorDark string `json:"colorDark"`
	Date      string `json:"date"` // "YYYY-MM-DD"
	Time      string `json:"time"` // "9:00 - 10:00"
}

var (
	// agendaFile defaults to a relative path so `go run .` from backend/
	// just works with zero configuration for local development. Production
	// deployments should set this to an absolute path under a mounted
	// volume (e.g. /data/agenda.json) so edits survive redeploys -- see
	// backend/README.md.
	agendaFile = String("AGENDA_FILE", "agenda.json")

	timeRangePattern = regexp.MustCompile(`^\d{1,2}:\d{2} - \d{1,2}:\d{2}$`)
	hexColorPattern  = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
)

// Agenda holds the current schedule, backed by a JSON file on disk so
// edits made through the backoffice survive restarts and redeploys.
type Agenda struct {
	mutex  sync.RWMutex
	events []AgendaEvent
	path   string
}

func NewAgenda(path string) *Agenda {
	return &Agenda{path: path}
}

// Load reads the agenda from disk, seeding it with a built-in default (and
// persisting that default immediately) if the file doesn't exist yet -- so
// the very first deploy isn't blank and there's always something on disk
// to edit.
func (a *Agenda) Load() error {
	data, err := os.ReadFile(a.path)
	if errors.Is(err, os.ErrNotExist) {
		return a.Replace(defaultAgendaEvents())
	}
	if err != nil {
		return fmt.Errorf("reading agenda file: %w", err)
	}

	var events []AgendaEvent
	if err := json.Unmarshal(data, &events); err != nil {
		return fmt.Errorf("parsing agenda file: %w", err)
	}

	a.mutex.Lock()
	a.events = events
	a.mutex.Unlock()
	return nil
}

// List returns a copy of the current events -- safe for the caller to
// read or mutate without affecting Agenda's own state.
func (a *Agenda) List() []AgendaEvent {
	a.mutex.RLock()
	defer a.mutex.RUnlock()
	out := make([]AgendaEvent, len(a.events))
	copy(out, a.events)
	return out
}

// Replace validates every event and, only if all of them pass, writes the
// new list to disk atomically (temp file + rename) before swapping it into
// memory. A validation failure or a write failure leaves both the
// in-memory and on-disk state exactly as they were -- the server never
// ends up serving something that didn't actually persist.
func (a *Agenda) Replace(events []AgendaEvent) error {
	for i, e := range events {
		if err := validateAgendaEvent(e); err != nil {
			return fmt.Errorf("event %d (%q): %w", i, e.Title, err)
		}
	}

	data, err := json.MarshalIndent(events, "", "  ")
	if err != nil {
		return fmt.Errorf("encoding agenda: %w", err)
	}

	if dir := filepath.Dir(a.path); dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("creating agenda directory: %w", err)
		}
	}

	tmp := a.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return fmt.Errorf("writing agenda file: %w", err)
	}
	if err := os.Rename(tmp, a.path); err != nil {
		return fmt.Errorf("saving agenda file: %w", err)
	}

	a.mutex.Lock()
	a.events = events
	a.mutex.Unlock()
	return nil
}

func validateAgendaEvent(e AgendaEvent) error {
	if e.Title == "" {
		return errors.New("title is required")
	}
	if _, err := time.Parse("2006-01-02", e.Date); err != nil {
		return fmt.Errorf("date %q must be YYYY-MM-DD: %w", e.Date, err)
	}
	if !timeRangePattern.MatchString(e.Time) {
		return fmt.Errorf("time %q must look like \"9:00 - 10:00\"", e.Time)
	}
	if e.Icon == "" {
		return errors.New("icon is required")
	}
	if e.IconColor == "" {
		return errors.New("iconColor is required")
	}
	if !hexColorPattern.MatchString(e.Color) {
		return fmt.Errorf("color %q must be a 6-digit hex code", e.Color)
	}
	if !hexColorPattern.MatchString(e.ColorDark) {
		return fmt.Errorf("colorDark %q must be a 6-digit hex code", e.ColorDark)
	}
	return nil
}

// defaultAgendaEvents seeds a fresh agenda.json on first boot with what
// used to be hardcoded in the frontend's schedule.json.
func defaultAgendaEvents() []AgendaEvent {
	return []AgendaEvent{
		{Title: "Grand Opening", Subtitle: "Welcome to the radio", Icon: "mdi-bullhorn-variant", IconColor: "red", Color: "#FFEBEE", ColorDark: "#A53747", Date: "2025-08-18", Time: "9:00 - 10:00"},
		{Title: "Centurion Marathon", Subtitle: "Beer activity for the brave.", Icon: "mdi-beer", IconColor: "amber", Color: "#FFF8E1", ColorDark: "#A28836", Date: "2025-08-19", Time: "16:30 - 20:00"},
		{Title: "Holland Casino", Subtitle: "Sound financial advice", Icon: "mdi-cash-multiple", IconColor: "green", Color: "#E6F7F2", ColorDark: "#4F8676", Date: "2025-08-20", Time: "14:00 - 15:00"},
		{Title: "Electroshock therapy", Subtitle: "Trust us", Icon: "mdi-brain", IconColor: "blue", Color: "#E3F2FD", ColorDark: "#3D739A", Date: "2025-08-20", Time: "18:00 - 19:00"},
		{Title: "Hot Ones", Subtitle: "Please dont sue us for copyright violations", Icon: "mdi-food-drumstick", IconColor: "red", Color: "#FFEBEE", ColorDark: "#A53747", Date: "2025-08-21", Time: "11:00 - 12:00"},
		{Title: "DOORHAAL. DONDERDAG.", Subtitle: "This year, you can listen to Intro Radio during the complete doorhaaldonderdag!", Icon: "mdi-sleep-off", IconColor: "purple", Color: "#F3E5F5", ColorDark: "#7C5282", Date: "2025-08-21", Time: "20:00 - 08:00"},
	}
}
