# Travel Plugin

Ridesharing trips with real-time tracking, route optimization, and passenger lifecycle management for the Qbix platform. Travel builds on Streams, Places, and Calendars to create a full carpooling/rideshare system — drivers create trips with origin and destination, passengers join with their pickup coordinates, the system calculates optimized routes via Google Directions, and real-time coordinate updates drive arrival detection and auto-pickup.

## Core Concepts

### Trips

A `Travel/trip` stream represents a journey from point A to point B, created by a driver and joinable by passengers. The stream is extended via `Travel_Trip` (stored in `travel_trip` table) which holds `directions` (the full Google Directions API response) and `coordinates` (JSON map of `{userId: {latitude, longitude, heading}}` for all participants).

Key stream attributes: `from` (origin with lat/lon), `to` (destination with lat/lon), `startTime`, `endTime`, `state` (new → started → ended), `type` (Travel/from or Travel/to — indicating whether the anchor time is departure or arrival), `venue`, `peopleMax`, `detourMax`, `detourType` (minutes/kilometers/miles), `labels` (access restriction).

### Trip Types

`Travel/from` — The driver specifies when they're departing. `startTime` is the anchor; `endTime` is calculated from route duration.

`Travel/to` — The driver specifies when they need to arrive. `endTime` is the anchor; `startTime` is calculated by subtracting route duration.

### Participant State Machine

Every participant in a trip has a `state` stored in `Streams_Participant.extra.state`. The state machine enforces valid transitions:

**Driver states:** `planning` → `driving` → `completed` or `discontinued` or `stopped`. The `stopped` state allows `driving` again (rest stops).

**Passenger states:** `observing` → `waiting` → `riding` → `arrived` or `expelled`. From `waiting`, a passenger can also transition to `canceled`.

`Travel_Trip::setState()` validates transitions against `Travel_Trip::$STATES` and throws `Travel_Exception_StateTransition` on invalid moves. Every state change posts a `Travel/trip/user/state` message.

### Trip Lifecycle

1. **Create** — `Travel_Trip::create()` creates the stream, calculates the initial route via Google Directions, relates the trip to Places/nearby streams at both origin and destination, sets the driver's state to `planning`, and sends notifications to nearby subscribers.

2. **Join** — `Travel_Trip::join()` validates capacity (`peopleMax`) and detour limits, sets the passenger's pickup coordinates, subscribes them to the trip, sets their state to `waiting`, and recalculates the route with the new waypoint.

3. **Start** — `Travel_Trip::start()` transitions the driver from `planning` to `driving`, sets the trip state to `started`, updates the origin to the driver's current position, and recalculates the route with current traffic.

4. **Coordinate Updates** — `Travel_Trip::setCoordinates()` updates a participant's position. When the driver's position updates, the system checks distance to each waiting passenger: if within `arriving` distance, posts a `Travel/trip/arriving` notification; if within `pickup` distance, auto-transitions the passenger to `riding`. It also checks if the driver deviates more than `route` meters from the polyline and recalculates if so. Finally checks proximity to the destination.

5. **Complete/Discontinue** — `Travel_Trip::completed()` marks all participants as `arrived` and closes the stream. `Travel_Trip::discontinue()` marks all as `discontinued` and closes.

### Route Calculation

`Travel_Trip::route()` calls the Google Directions API with the trip's origin, destination, and all waiting passengers' coordinates as waypoints. Waypoints are optimized by default (`optimize:true`). The response is stored in `travel_trip.directions`. The method also builds a `pickups` array that maps the optimized waypoint order back to userIds, so the UI can show pickup sequence.

When a passenger is picked up (state → `riding`), their waypoint is removed from subsequent route calculations. The route auto-recalculates when the driver deviates beyond `Travel.Trip.distances.route` meters from the current polyline.

### Detour Limits

When a passenger tries to join, the system can enforce detour constraints. If `detourMax` and `detourType` are set on the trip, `join()` calculates a hypothetical route including the new passenger and checks whether the added time or distance exceeds the limit. Throws `Travel_Exception_TripDuration` if exceeded.

### Nearby Notifications

When a trip is created, `Travel_Trip::sendNotifications()` finds all `Places/nearby` streams within `Travel.Trip.distances.subscribe` meters of the trip's anchor point (origin for Travel/from, destination for Travel/to) and posts `Travel/trip/added` messages. Passengers who have subscribed to those nearby streams receive notifications about new trips in their area.

### Recurring Trips

Trips integrate with the Calendars recurring system. `Travel_Trip::create()` calls `Calendars_Recurring::makeRecurring()` if recurring info is provided, and relates the trip's recurring category to the parent event's recurring category. Per-user day preferences are stored in the recurring participant extras, and `changeUserParticipation()` updates them when passengers join or cancel.

## Database Schema

### travel_trip (extends Travel/trip streams)
```
publisherId  varbinary(31)   PK
streamName   varbinary(255)  PK
directions   mediumtext      NULL  — full Google Directions API JSON response
coordinates  text            NULL  — JSON: {userId: {latitude, longitude, heading}}
```

## Stream Types

| Type | Purpose |
|---|---|
| `Travel/trip` | A trip from origin to destination (extended by Travel_Trip) |

## Participant States & Transitions

```
Driver:    planning → driving → completed
                    → driving → stopped → driving (resume)
                    → driving → discontinued
                    → discontinued (from planning)

Passenger: observing → waiting → riding → arrived
                     → waiting → canceled
                     → riding  → expelled
```

## Messages

| Type | When |
|---|---|
| `Travel/trip/started` | Driver starts the trip |
| `Travel/trip/arriving` | Driver within `arriving` meters of a waiting passenger |
| `Travel/trip/pickedup` | Passenger auto-picked-up (within `pickup` meters) |
| `Travel/trip/completed` | Trip completed by driver |
| `Travel/trip/discontinued` | Trip discontinued by driver |
| `Travel/trip/user/state` | Any participant state change |
| `Travel/coordinates/updated` | Participant position update |
| `Travel/trip/added` | Posted to Places/nearby streams when trip created |

## Configuration

```json
{
    "Travel": {
        "Trip": {
            "arriveTime": 7200,
            "departTime": 900,
            "distances": {
                "route": 100,
                "arriving": 100,
                "pickup": 10,
                "riding": 100,
                "mapZoom": 100,
                "subscribe": 1000
            }
        }
    }
}
```

`distances.route` — meters of deviation from polyline before route recalculation. `distances.arriving` — meters from passenger at which `Travel/trip/arriving` fires. `distances.pickup` — meters from passenger at which auto-pickup happens (state → riding). `distances.subscribe` — radius in meters for sending new-trip notifications to nearby subscribers.