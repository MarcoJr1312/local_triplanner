# Triplanner — 10-minute demo tour

This is the fastest path through the recruiter demo. The stack must be running:

```bash
docker compose -f deploy/docker-compose.yml up --build
docker compose -f deploy/docker-compose.yml ps
```

All five services should show `healthy`.

## 1. Sign in as the owner

Open http://localhost:3000/login and choose **Demo (owner)**.

The UI starts in English. Switch to Spanish at any time in
**Profile → Language**.

You should land on the trips dashboard with the seeded trip
**“Fin de semana en Toronto”** (Dec 4–6, 2026).

## 2. Explore the itinerary

Open the trip. It has nine real Toronto places across three days:

| Day | Examples |
|---|---|
| Dec 4 | High Park, CN Tower, Royal Ontario Museum |
| Dec 5 | Black+Blue, PAI, Edna + Vita |
| Dec 6 | Riverdale Farm, Exhibition Place, 10 DEAN |

Point out the day tabs, budget summary, activity categories and calendar view.

## 3. Search real places

Use the trip search:

- `CN Tower`
- `Royal Ontario Museum`
- `restaurant`
- `nightlife`

Results come from the local MongoDB catalogue. No HasData key is used at
runtime. Select a place and add it to a day. Click a result to open its detail
modal with address, rating, phone, hours, description, links and Google Maps.

## 4. Test collaboration without email

1. Open **Invite** on the trip.
2. Leave the prefilled `friend@triplanner.local`.
3. Create the invitation and click **Copy link**.
4. Open the link in an incognito window.
5. Choose **Join as Demo Friend**.

The second identity joins as a viewer. Switch back to the owner to see the
member list update.

> Email delivery is intentionally disabled in this demo. The copyable link is
> the invitation.

## 5. Upload something

Open the profile menu and upload an avatar, or open an activity and attach a
PDF/image. Uploads live in the `uploads` Docker volume and survive restarts.

## 6. Try the AI panel

Open **AI suggestions**:

- The badge **AI demo mode** means no LLM provider is configured.
- Click **Auto suggestions** to rank places from the catalogue.
- Ask: `¿Qué me recomiendas para el primer día?`
- The assistant returns a deterministic answer with addable suggestion cards.
- Use **Add** to put a card on a day.

To enable a real provider, see the “LLM providers” section in the root README.

Configure a real provider from **Profile → AI provider**: choose the provider,
paste the token and optionally set the model and base URL. The token is stored
in the local agent volume and is never returned to the browser. Environment
variables remain the fallback defaults.

## 7. Routes and Uber

Open an activity:

- **Formar ruta** builds a Google Maps multi-stop link ordered by start time.
- **Uber** opens a deep link with the destination preloaded.

## 8. Reset

```bash
docker compose -f deploy/docker-compose.yml down       # stop, keep data
docker compose -f deploy/docker-compose.yml down -v    # reset data; next start re-seeds
```

The next `docker compose -f deploy/docker-compose.yml up -d` recreates the Toronto catalogue, the demo users
and the three-day trip.
