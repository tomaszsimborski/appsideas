# Tomkowe pomysły

Tutaj eksploruję swoje pomysły. Każdy pomysł to osobny, samodzielny produkt
we własnym folderze. Strona główna (`index.html`) pokazuje je jako kafle z
podglądem, a kliknięcie kafla otwiera dany produkt.

**Na żywo:** <https://tomaszsimborski.github.io/appsideas/>
(GitHub Pages z gałęzi `Main`). Możesz też otworzyć `index.html` w Chrome
prosto z dysku.

## Pomysły

| Pomysł | Folder | Opis |
|---|---|---|
| Wolne sale prób | [`sale-prob/`](sale-prob/) | Sprawdza grafiki sal prób Dźwiękówy i Plug&Play we Wrocławiu i pokazuje, które są wolne w wybranym terminie. Dane pobiera GitHub Action co ~30 min. |
| Beatbox to Drum Grid | [`beatbox-grid/`](beatbox-grid/) | Zamienia beatbox („tu” stopa, „ta” werbel, „ts” hi-hat) na siatkę perkusyjną, z metronomem i odliczaniem. |

## Jak dodać nowy pomysł

1. Utwórz folder, np. `moj-pomysl/`, z samodzielną aplikacją: własny
   `index.html` i to, czego potrzebuje. Bez wspólnego kodu między pomysłami,
   żeby każdy mógł żyć swoim życiem.
2. Dodaj podgląd na kafel: `moj-pomysl/preview.svg` (albo `.png`/`.jpg`) w
   proporcjach 16:10, np. 640×400.
3. Dodaj wpis na początku listy w [`ideas.js`](ideas.js): tytuł, opis, link,
   podgląd, tagi i datę.
4. W aplikacji dodaj link powrotny `<a href="../index.html">← Tomkowe pomysły</a>`.
5. Dopisz wiersz do tabeli powyżej.
