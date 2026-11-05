package cli

import (
	"os"
	"slices"
	"testing"

	"github.com/yetone/magpie/internal/provider"
)

func TestSearchCLIClearsURLWithPick(t *testing.T) {
	for _, pick := range []string{"order", "turns"} {
		t.Run(pick, func(t *testing.T) {
			t.Setenv("HOME", t.TempDir())
			t.Setenv("USERPROFILE", os.Getenv("HOME"))
			t.Setenv("XDG_CONFIG_HOME", t.TempDir())
			if err := searchCmd([]string{"add", "exa", "fixture-A", "url=https://relay.example"}); err != nil {
				t.Fatal(err)
			}
			if err := searchCmd([]string{"add", "exa", "fixture-B", "url=", "pick=" + pick}); err != nil {
				t.Fatal(err)
			}
			a := provider.StoredSearchAPIs()[0]
			if a.URL != "" || a.Base() != "https://api.exa.ai" || a.Key != "fixture-B" {
				t.Fatalf("explicit URL clear with pick=%s ignored: %+v", pick, a)
			}
		})
	}
}

func TestSearchCLIRequiresWholeKeyPositions(t *testing.T) {
	for _, command := range []string{"rm", "remove"} {
		for _, arg := range []string{"2oops", "1.5", "0", "-1", "99999999999999999999"} {
			t.Run(command+"/"+arg, func(t *testing.T) {
				t.Setenv("HOME", t.TempDir())
				t.Setenv("USERPROFILE", os.Getenv("HOME"))
				t.Setenv("XDG_CONFIG_HOME", t.TempDir())
				for _, a := range []provider.SearchAPI{{Vendor: "exa", Key: "fixture-A,fixture-B,fixture-C"}, {Vendor: "brave", Key: "fixture-D"}} {
					if err := provider.SetSearchAPI(a); err != nil {
						t.Fatal(err)
					}
				}
				before := slices.Clone(provider.StoredSearchAPIs())
				err := searchCmd([]string{command, "exa", arg})
				if err == nil {
					t.Errorf("malformed position %q accepted", arg)
				}
				if after := provider.StoredSearchAPIs(); !slices.Equal(before, after) {
					t.Errorf("malformed position changed settings: before=%+v after=%+v", before, after)
				}
			})
		}
	}
}
