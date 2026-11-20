# Licznik zdrowia — Hero Realms

Licznik punktów życia dla dwóch graczy, wzorowany na aplikacji Authority do
Star Realms, w barwach Hero Realms. Czysty HTML, CSS i JavaScript: bez
budowania, bez serwera, bez zależności.

## Jak działa

- Ekran dzieli się na pół: **w pionie** na górę i dół, **w poziomie** na lewo i
  prawo. Układ zmienia się sam po obróceniu telefonu.
- Każdy gracz ma czerwony **miecz** (obrażenia, −1) i zielone **serce**
  (leczenie, +1). Przytrzymanie przycisku liczy szybciej.
- Zmiany zbierają się przez chwilę jako „−7” nad liczbą, a po ~1,4 s bez dotyku
  trafiają do historii (ostatnie zmiany widać pod liczbą).
- Gdy zdrowie spadnie do 0 lub niżej, każda połówka pokazuje swój wynik:
  **Zwycięstwo** albo **Porażka**, z przyciskiem **Rewanż**.
- Pasek na środku: **cofnij** ostatnią zmianę (działa też po końcu gry),
  **ustawienia / nowy pojedynek**, **od nowa** (dotknij dwa razy).
- Ekran nie gaśnie w trakcie gry (Wake Lock), a stan gry przetrwa
  odświeżenie strony.

## Ustawienia przed pojedynkiem

- Startowe zdrowie (domyślnie 50; szybkie 40/50/60/75/100 albo dowolna liczba).
- Imiona graczy (domyślnie Tomek i Berenika).
- Miejsce: lewo / prawo. W pionie gracz z lewej jest na górze (jak po obróceniu
  telefonu w prawo).
- Kolor gracza: Gildia, Nekros, Imperium, Dzicz, Magia, Stal.
- Ułożenie: **naprzeciw siebie** (liczby obrócone do każdego gracza) albo
  **obok siebie** (obie połówki prosto).

Ustawienia zapisują się w przeglądarce i są podpowiadane przy następnym
pojedynku.
