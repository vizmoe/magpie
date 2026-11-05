package gui

import (
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/yetone/magpie/internal/provider"
)

func searchKeySetup(t *testing.T) {
	t.Helper()
	h := t.TempDir()
	t.Setenv("HOME", h)
	t.Setenv("USERPROFILE", h)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(h, ".config"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(h, ".cache"))
	if err := provider.SetSearchAPI(provider.SearchAPI{Vendor: "exa", Key: "fixture-A,fixture-B,fixture-C", URL: "https://relay.example", Pick: "order", Off: true}); err != nil {
		t.Fatal(err)
	}
	if err := provider.SwitchSearchAPI("exa", false); err != nil {
		t.Fatal(err)
	}
}

func searchKeyPost(t *testing.T, route string, body any) *httptest.ResponseRecorder {
	t.Helper()
	data, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	Handler(nil, nil).ServeHTTP(rec, httptest.NewRequest("POST", "/api/settings/"+route, strings.NewReader(string(data))))
	return rec
}

func TestSearchAPIKeyReference(t *testing.T) {
	for _, action := range []string{"remove", "replace", "copy"} {
		t.Run(action, func(t *testing.T) {
			searchKeySetup(t)
			ref := provider.KeyID("fixture-B")
			if err := provider.SetSearchAPI(provider.SearchAPI{Vendor: "exa", Key: "fixture-B,fixture-C", URL: "https://relay.example"}); err != nil {
				t.Fatal(err)
			}
			route := "search-api"
			body := map[string]any{"vendor": "exa", "ref": ref}
			want := []string{"fixture-C"}
			switch action {
			case "remove":
				body["remove"] = true
			case "replace":
				body["key"] = "fixture-new-B"
				want = []string{"fixture-new-B", "fixture-C"}
			case "copy":
				route = "search-key"
				want = []string{"fixture-B", "fixture-C"}
			}
			rec := searchKeyPost(t, route, body)
			if rec.Code != 200 {
				t.Fatalf("%s: %d %s", action, rec.Code, rec.Body)
			}
			if action == "copy" {
				var out struct{ Key string }
				if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil || out.Key != "fixture-B" {
					t.Fatalf("copied a different key: %s (%v)", rec.Body, err)
				}
			}
			as := provider.StoredSearchAPIs()
			if len(as) != 1 || !slices.Equal(as[0].Keys(), want) || !as[0].Off || as[0].Pick != "order" || as[0].URL != "https://relay.example" {
				t.Fatalf("%s changed another key or setting: %+v, want keys %v", action, as, want)
			}
		})
	}
}

func TestSearchAPIKeyRefusedEdits(t *testing.T) {
	for _, tc := range []struct {
		name, route string
		body        map[string]any
	}{
		{"null ref remove", "search-api", map[string]any{"ref": nil, "remove": true}},
		{"null ref replace", "search-api", map[string]any{"ref": nil, "key": "fixture-D"}},
		{"null ref copy", "search-key", map[string]any{"ref": nil}},
		{"null at remove", "search-api", map[string]any{"at": nil, "remove": true}},
		{"null at replace", "search-api", map[string]any{"at": nil, "key": "fixture-D"}},
		{"null at copy", "search-key", map[string]any{"at": nil}},
		{"duplicate", "search-api", map[string]any{"ref": provider.KeyID("fixture-B"), "key": "fixture-A"}},
		{"several", "search-api", map[string]any{"ref": provider.KeyID("fixture-B"), "key": "fixture-D,fixture-E"}},
		{"missing replace", "search-api", map[string]any{"ref": provider.KeyID("gone"), "key": "fixture-D"}},
		{"missing remove", "search-api", map[string]any{"ref": provider.KeyID("gone"), "remove": true}},
		{"missing copy", "search-key", map[string]any{"ref": provider.KeyID("gone")}},
		{"empty ref remove", "search-api", map[string]any{"ref": "", "remove": true}},
		{"empty ref copy", "search-key", map[string]any{"ref": ""}},
		{"positional replace", "search-api", map[string]any{"at": 1, "key": "fixture-D"}},
		{"positional remove", "search-api", map[string]any{"at": 1, "remove": true}},
		{"positional copy", "search-key", map[string]any{"at": 1}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			searchKeySetup(t)
			before := slices.Clone(provider.StoredSearchAPIs())
			tc.body["vendor"] = "exa"
			rec := searchKeyPost(t, tc.route, tc.body)
			if rec.Code < 400 {
				t.Errorf("unsafe edit accepted: %d", rec.Code)
			}
			if after := provider.StoredSearchAPIs(); !slices.Equal(before, after) {
				t.Errorf("refused edit changed settings: before=%+v after=%+v", before, after)
			}
		})
	}
}

func TestSearchAPIKeyReferencesListed(t *testing.T) {
	searchKeySetup(t)
	const keys = "tvly-first-0001,tvly-other-0001"
	if err := provider.SetSearchAPI(provider.SearchAPI{Vendor: "tavily", Key: keys}); err != nil {
		t.Fatal(err)
	}
	var s settingsJSON
	searchState(&s)
	data, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	var out struct {
		SearchAPIs []struct {
			Vendor  string
			KeyList []struct{ ID, Key string }
		}
	}
	if err := json.Unmarshal(data, &out); err != nil {
		t.Fatal(err)
	}
	ks := out.SearchAPIs[1].KeyList
	if len(ks) != 2 || ks[0].ID == "" || ks[0].ID == ks[1].ID || ks[0].Key != ks[1].Key {
		t.Fatalf("keys with equal masked values need distinct stable references: %+v", ks)
	}
	for _, key := range strings.Split(keys, ",") {
		if strings.Contains(string(data), key) {
			t.Fatal("settings exposed a whole key")
		}
	}
}

func TestSearchAPIKeyRemovalKeepsOptionalAPI(t *testing.T) {
	searchKeySetup(t)
	if err := provider.SetSearchAPI(provider.SearchAPI{Vendor: "you", Key: "fixture-D", URL: "https://you.example", Pick: "order"}); err != nil {
		t.Fatal(err)
	}
	body := map[string]any{"vendor": "you", "ref": provider.KeyID("fixture-D"), "remove": true}
	if rec := searchKeyPost(t, "search-api", body); rec.Code != 200 {
		t.Fatalf("remove optional key: %d %s", rec.Code, rec.Body)
	}
	as := provider.StoredSearchAPIs()
	if len(as) != 2 || as[1].Key != "" || as[1].URL != "https://you.example" || as[1].Pick != "order" || !as[1].Ready() {
		t.Fatalf("removing an optional key changed its API: %+v", as)
	}
	if rec := searchKeyPost(t, "search-api", body); rec.Code < 400 {
		t.Fatal("a repeated removal must refuse the deleted reference")
	}
	if after := provider.StoredSearchAPIs(); !slices.Equal(as, after) {
		t.Fatalf("a repeated removal changed settings: %+v", after)
	}
}

func TestSearchAPIURLPresence(t *testing.T) {
	for _, pick := range []string{"order", "turns"} {
		t.Run(pick, func(t *testing.T) {
			searchKeySetup(t)
			body := map[string]any{"vendor": "exa", "pick": pick}
			if rec := searchKeyPost(t, "search-api", body); rec.Code != 200 {
				t.Fatalf("pick: %d %s", rec.Code, rec.Body)
			}
			if got := provider.StoredSearchAPIs()[0].URL; got != "https://relay.example" {
				t.Fatalf("omitted URL changed saved endpoint: %q", got)
			}
			body["url"] = ""
			if rec := searchKeyPost(t, "search-api", body); rec.Code != 200 {
				t.Fatalf("clear URL: %d %s", rec.Code, rec.Body)
			}
			if got := provider.StoredSearchAPIs()[0]; got.URL != "" || got.Base() != "https://api.exa.ai" {
				t.Fatalf("explicit URL clear ignored: %+v", got)
			}
		})
	}
}
