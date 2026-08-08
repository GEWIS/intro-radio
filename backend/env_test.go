package main

import (
	"os"
	"reflect"
	"testing"
)

func TestStringSlice(t *testing.T) {
	const key = "TEST_STRING_SLICE_ENV"
	fb := []string{"fallback-a", "fallback-b"}

	tests := []struct {
		name  string
		value string
		unset bool
		want  []string
	}{
		{name: "unset env returns fallback", unset: true, want: fb},
		{name: "empty env returns fallback", value: "", want: fb},
		{name: "single value", value: "https://radio.gewis.nl", want: []string{"https://radio.gewis.nl"}},
		{
			name:  "comma separated values are split",
			value: "https://radio.gewis.nl,http://localhost:3000",
			want:  []string{"https://radio.gewis.nl", "http://localhost:3000"},
		},
		{
			name:  "whitespace around entries is trimmed",
			value: " https://radio.gewis.nl , http://localhost:3000 ",
			want:  []string{"https://radio.gewis.nl", "http://localhost:3000"},
		},
		{
			name:  "empty entries between commas are dropped",
			value: "https://radio.gewis.nl,,http://localhost:3000,",
			want:  []string{"https://radio.gewis.nl", "http://localhost:3000"},
		},
		{name: "only commas and whitespace returns fallback", value: " , , ", want: fb},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.unset {
				os.Unsetenv(key)
			} else {
				t.Setenv(key, tt.value)
			}

			got := StringSlice(key, fb)
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("StringSlice(%q, %v) = %v, want %v", key, fb, got, tt.want)
			}
		})
	}
}
