# Wolne sale prób

Wybierasz dzień, godzinę i długość próby, a strona pokazuje, które sale prób
we Wrocławiu są wtedy wolne. Sprawdza cztery miejsca:

- **Dźwiękówa** (<https://dzwiekowa.pl/rezerwacja-online/>): Browar, Młyn,
  Bystrzycka 69, Tęczowa 57 sala A i B, Zaklęte Rewiry duża i mała.
- **Plug&Play** (<https://www.sala-prob.pl/>): Sala 1 i 2 na pl. Wróblewskiego,
  Sala A i B na ul. Fabrycznej.
- **Próbówka Music House** (<https://probowka.nakiedy.pl/>): Sala A i B na
  ul. Robotniczej.
- **Melodyka** (<https://saleprobmelodyka.pl/>): jedna sala na ul. Fabrycznej,
  czynna całą dobę.

Przy zajętej sali widać, kiedy jest zajęta, i najbliższy wolny termin tej
samej długości tego dnia. Kliknięcie go przestawia godzinę.

## Jak to działa

Dźwiękówa i Plug&Play mają publiczne API z grafikiem. Próbówka (nakiedy.pl)
i Melodyka (asysto.pl) pokazują tylko wolne godziny, więc skrypt odczytuje je
ze stron rezerwacji i z nich wylicza zajęte godziny. Żaden z
tych systemów nie pozwala stronie z innej domeny pobierać danych, dlatego
robi to GitHub Action:

1. [`.github/workflows/sale-prob-data.yml`](../.github/workflows/sale-prob-data.yml)
   co ok. 30 minut uruchamia [`fetch-data.js`](fetch-data.js).
2. Skrypt pobiera zajęte terminy na 4 tygodnie do przodu i zapisuje je jako
   `availability.json` na gałęzi `sale-prob-data` (zawsze jeden commit, więc
   repo nie puchnie).
3. Strona czyta ten plik z `raw.githubusercontent.com` i porównuje rezerwacje z
   wybranym terminem ([`availability.js`](availability.js)).

Dane mogą być sprzed pół godziny albo trochę starsze, bo GitHub czasem
opóźnia zaplanowane uruchomienia. Godzinę pobrania widać na dole strony.
Przed próbą zawsze zarezerwuj salę w jej systemie.

Uwaga: zaplanowane uruchomienia działają tylko z domyślnej gałęzi (`Main`), a
GitHub je wyłącza, jeśli w repo przez 60 dni nic się nie dzieje. Wtedy włącz
je z powrotem w zakładce **Actions**.

## Lokalnie

```sh
node sale-prob/fetch-data.js sale-prob/availability.json
python3 -m http.server
# http://localhost:8000/sale-prob/?data=availability.json
node sale-prob/test/availability.test.js
```

Ceny Plug&Play nie są w ich API, więc są wpisane w `fetch-data.js`. Gdy się
zmienią, trzeba je tam poprawić.
