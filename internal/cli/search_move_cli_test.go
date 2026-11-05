package cli

import (
	"os"
	"slices"
	"testing"

	"github.com/yetone/magpie/internal/provider"
)

func searchMoveSetup(t *testing.T) []provider.SearchAPI {
	t.Helper()
	t.Setenv("HOME", t.TempDir())
	t.Setenv("USERPROFILE", os.Getenv("HOME"))
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	for _, a := range []provider.SearchAPI{{Vendor: "exa", Key: "fixture-exa"}, {Vendor: "brave", Key: "fixture-brave"}} {
		if err := provider.SetSearchAPI(a); err != nil {
			t.Fatal(err)
		}
	}
	return slices.Clone(provider.StoredSearchAPIs())
}

func TestSearchMoveRejectsMalformedPositions(t *testing.T) {
	for _, command := range []string{"move", "mv"} {
		for _, arg := range []string{"2oops", "1.5", "0", "-1", "3", "99999999999999999999"} {
			t.Run(command+"/"+arg, func(t *testing.T) {
				before := searchMoveSetup(t)
				if err := searchCmd([]string{command, "exa", arg}); err == nil {
					t.Errorf("invalid position %q accepted", arg)
				}
				if after := provider.StoredSearchAPIs(); !slices.Equal(before, after) {
					t.Errorf("invalid position changed settings: before=%+v after=%+v", before, after)
				}
			})
		}
	}
}

func TestSearchMoveBoundaryPositions(t *testing.T) {
	for _, command := range []string{"move", "mv"} {
		for _, tc := range []struct{ vendor, position string }{{"brave", "1"}, {"exa", "2"}} {
			t.Run(command+"/"+tc.position, func(t *testing.T) {
				before := searchMoveSetup(t)
				if err := searchCmd([]string{command, tc.vendor, tc.position}); err != nil {
					t.Fatal(err)
				}
				want := []provider.SearchAPI{before[1], before[0]}
				if after := provider.StoredSearchAPIs(); !slices.Equal(want, after) {
					t.Fatalf("valid move: got %+v, want %+v", after, want)
				}
			})
		}
	}
}
