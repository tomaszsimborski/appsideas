# Warsztat utworów

Jedno miejsce na wszystko, co powstaje w zespole: inspiracje, nagrania z prób,
riffy, szkice z Logic, tekst, akordy, tempo i notatki. W centrum są **utwory**,
a każde nagranie można do utworu przypiąć. Czysty HTML, CSS i JavaScript: bez
budowania, bez serwera, bez zależności.

## Jak działa

**Utwory** (pierwsza zakładka)

- Lista utworów z filtrem po statusie i wyszukiwarką (tytuły, teksty, notatki).
- Status zmienia się jednym dotknięciem: na liście (przycisk ze statusem) albo
  w utworze (pasek etapów). Statusy w kolejności pracy:
  **Motyw → Koncept → Forma → Dopracowywanie → Zrobione → Nagrane**.
- W utworze:
  - **docelowe tempo w BPM**: −/+ (przytrzymaj, żeby zmieniać szybciej),
    **Wystukaj** (tap tempo) i **Metronom**,
  - **warstwy tekstowe**: Tekst (do śpiewania), Akordy (czcionka o stałej
    szerokości, żeby akordy trzymały się kolumn) i Notatki. Zapisują się same.
    Kropka przy zakładce znaczy, że warstwa ma treść,
  - **nagrania i materiały** pogrupowane według folderów, z przyciskiem
    **+ Dodaj** (nagraj, wgraj plik, link ze Spotify),
  - w menu ⋯: kopiowanie tekstu, akordów i notatek do wysłania zespołowi oraz
    usuwanie utworu (nagrania zostają w folderach).

**Foldery** (trzecia zakładka)

- **Nagrania z prób**, **Motywy i riffy**, **Inspiracje**, **Szkice z DAW**.
- W każdym folderze: nagrywanie z mikrofonu i wgrywanie plików audio lub
  wideo (dyktafon, bounce z Logic, wideo z riffem). W Inspiracjach dodatkowo
  link do utworu, albumu albo playlisty ze Spotify.
- ⋯ przy nagraniu: zmiana nazwy, przypisanie do utworu, przeniesienie do
  innego folderu, pobranie pliku, usunięcie.

**Nagrywanie** (pomarańczowy mikrofon na środku)

- Działa z każdego ekranu; w utworze od razu przypisuje nagranie do niego.
- Wskaźnik poziomu, licznik czasu i opcjonalny klik metronomu w tempie utworu
  (najlepiej w słuchawkach).

**Odtwarzacz**

- Mini-odtwarzacz nad dolnym paskiem; dotknięcie otwiera pełny widok.
- Pełny widok pokazuje tytuł utworu, tempo i status, falę dźwięku (dotknij
  albo przeciągnij, żeby przewinąć), ±10 s, zapętlanie i wolniejsze
  odtwarzanie (0,75× i 0,5× bez zmiany wysokości dźwięku) do nauki riffów.
- Pod spodem **warstwy tekstowe utworu**: możesz śpiewać z tekstem, mieć
  otwarte akordy albo pisać tekst w trakcie słuchania. Nagranie bez utworu
  można tu przypisać albo utworzyć z niego nowy utwór.
- Linki ze Spotify grają we wbudowanym odtwarzaczu Spotify (całe utwory po
  zalogowaniu do Spotify w przeglądarce).
- Spacja: odtwarzanie / pauza, Esc: zwija odtwarzacz.

## Dane

Wszystko (również pliki audio i wideo) zapisuje się w przeglądarce na tym
urządzeniu (IndexedDB). Nic nie jest wysyłane na serwer, więc dane z telefonu
nie pojawią się same na komputerze. Do przenoszenia służy **Kopia** w
zakładce Foldery: pobiera plik `.json` z utworami i nagraniami, który na innym
urządzeniu wczytasz przyciskiem **Wczytaj**.

## Uruchomienie

Otwórz `warsztat/index.html` w Chrome albo wejdź na
<https://tomaszsimborski.github.io/appsideas/warsztat/>. Nagrywanie z
mikrofonu wymaga `https://` (GitHub Pages) albo `localhost`; z dysku
(`file://`) można wgrywać pliki, ale przeglądarka może nie dać mikrofonu.

Na telefonie warto dodać stronę do ekranu głównego, wtedy otwiera się jak
aplikacja.

## Testy

```
node warsztat/test/lib.test.js
```

Sprawdzają czyste funkcje z `lib.js`: statusy, tempo i tap tempo, linki
Spotify, formatowanie czasu, polską odmianę, wyszukiwanie i miniaturę fali.
