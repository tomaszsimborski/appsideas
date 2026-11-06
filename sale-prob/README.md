# Wolne sale prób

Wybierasz dzień, godzinę i długość próby, a strona pokazuje, które sale prób
we Wrocławiu są wtedy wolne. Sprawdza pięć miejsc, czyli wszystkie, które
mają rezerwację online (według katalogu BookMySound, październik 2026):

- **Dźwiękówa** (<https://dzwiekowa.pl/rezerwacja-online/>): Browar, Młyn,
  Bystrzycka 69, Tęczowa 57 sala A i B, Zaklęte Rewiry duża i mała.
- **Plug&Play** (<https://www.sala-prob.pl/>): Sala 1 i 2 na pl. Wróblewskiego,
  Sala A i B na ul. Fabrycznej.
- **Próbówka Music House** (<https://probowka.nakiedy.pl/>): Sala A i B na
  ul. Robotniczej.
- **Melodyka** (<https://saleprobmelodyka.pl/>): jedna sala na ul. Fabrycznej,
  czynna całą dobę.
- **Proste i Krzywe** (<https://prosteikrzywe.pl/rezerwacje/>): Red, Green i
  X Zone na ul. Hubskiej.

Przy zajętej sali widać, kiedy jest zajęta, i najbliższy wolny termin tej
samej długości tego dnia. Kliknięcie go przestawia godzinę.

Przy każdej sali jest też metraż i informacja, czy na miejscu jest perkusja i
klawisze. Te dane są przepisane ręcznie ze stron sal w
[`rooms-info.js`](rooms-info.js), więc gdy sala zmieni wyposażenie, trzeba
je tam poprawić.

## Jak to działa

Dźwiękówa i Plug&Play mają publiczne API z grafikiem, a Proste i Krzywe
(Bookero) API z listą godzin, w której zajęte nie mają wolnych miejsc.
Próbówka (nakiedy.pl) i Melodyka (asysto.pl) pokazują tylko wolne godziny,
więc skrypt odczytuje je ze stron rezerwacji i z nich wylicza zajęte. Żaden z
tych systemów nie pozwala stronie z innej domeny pobierać danych, dlatego
robi to GitHub Action, uruchamiany ręcznie:

1. [`.github/workflows/sale-prob-data.yml`](../.github/workflows/sale-prob-data.yml)
   uruchamia [`fetch-data.js`](fetch-data.js), gdy w zakładce **Actions**
   wybierzesz „Sale prób – grafiki” i klikniesz **Run workflow**. Strona
   apki ma link „Odśwież grafiki”, który prowadzi prosto tam.
2. Skrypt pobiera zajęte terminy na 4 tygodnie do przodu i zapisuje je jako
   `availability.json` na gałęzi `sale-prob-data` (zawsze jeden commit, więc
   repo nie puchnie).
3. Strona czyta ten plik z `raw.githubusercontent.com` i porównuje rezerwacje z
   wybranym terminem ([`availability.js`](availability.js)).

Grafiki nie odświeżają się same, więc są aktualne na chwilę ostatniego
uruchomienia. Godzinę pobrania widać pod podsumowaniem, a gdy minęło więcej
niż 6 godzin, robi się żółta. Przed próbą zawsze zarezerwuj salę w jej
systemie. Pobrane dane sięgają 4 tygodnie od dnia pobrania.

## Lokalnie

```sh
node sale-prob/fetch-data.js sale-prob/availability.json
python3 -m http.server
# http://localhost:8000/sale-prob/?data=availability.json
node sale-prob/test/availability.test.js
```

Ceny Plug&Play nie są w ich API, więc są wpisane w `fetch-data.js`. Gdy się
zmienią, trzeba je tam poprawić.
