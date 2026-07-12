# Travel Plugin — LLM Coding Primer

Supplement to the Q Framework, Streams, Places, and Calendars primers. Covers
trip creation, the participant state machine, real-time coordinate tracking,
route calculation, and ridesharing lifecycle.

---

## 1. Creating a Trip

```php
// Create a trip (as driver)
$result = Travel_Trip::create($asUserId, array(
    'attributes' => array(
        'type'      => 'Travel/from',     // 'Travel/from' (depart at time) or 'Travel/to' (arrive by time)
        'from'      => array('latitude' => 40.7128, 'longitude' => -74.0060),
        'to'        => array('latitude' => 40.7580, 'longitude' => -73.9855),
        'startTime' => time() + 900,       // required for Travel/from
        'endTime'   => null,               // required for Travel/to
        'venue'     => 'Times Square',
        'peopleMax' => 4,
        'detourMax' => 15,
        'detourType'=> 'minutes',          // 'minutes', 'kilometers', 'miles'
        'labels'    => null                // tab-delimited access labels
    ),
    'recurringInfo' => array(              // null for one-time trips
        'period' => 'weekly',
        'days'   => array('Mon' => array(), 'Wed' => array())
    )
), $relateToStream);  // optional event/category to relate to
// Returns: ['stream' => Streams_Stream, 'participant' => Streams_Participant]
// Driver state is set to 'planning'
// Route is calculated via Google Directions
// Trip is related to Places/nearby streams at origin and destination
// Notifications sent to nearby subscribers
```

---

## 2. Participant State Machine

```php
// Valid transitions:
$STATES = array(
    'observing' => array('waiting'),           // passenger default
    'waiting'   => array('riding', 'canceled'),
    'riding'    => array('expelled', 'arrived'),
    'planning'  => array('driving', 'discontinued'),  // driver default
    'driving'   => array('completed', 'stopped', 'discontinued'),
    'stopped'   => array('driving', 'discontinued')
);

// Set participant state (validates transition, posts message)
Travel_Trip::setState($tripStream, $userId, 'waiting', array(
    'coordinates' => array('latitude' => 40.72, 'longitude' => -74.00)
));
// Throws Travel_Exception_StateTransition if invalid transition
// Posts Travel/trip/user/state message
// If state='riding': recalculates route, posts pickup message
// If state='waiting'|'canceled': updates recurring participation
```

---

## 3. Trip Lifecycle

```php
// DRIVER: Start the trip
Travel_Trip::start($tripStream, $driverId, array(
    'latitude'  => 40.7128,
    'longitude' => -74.0060,
    'heading'   => 45.0
));
// Transitions driver: planning → driving
// Sets trip state to 'started', updates origin to current position
// Recalculates route with current traffic data
// Throws if not the publisher or if state != 'planning'

// PASSENGER: Join the trip
Travel_Trip::join($tripStream, $passengerId, array(
    'latitude'  => 40.7200,
    'longitude' => -73.9950
));
// Checks peopleMax capacity
// Checks detourMax limits (calculates hypothetical route)
// Sets passenger coordinates and state to 'waiting'
// Subscribes to trip notifications
// Recalculates route with new waypoint
// Throws Streams_Exception_Full if at capacity
// Throws Travel_Exception_TripDuration if detour exceeds limit
// Throws Travel_Exception_TripAlreadyStarted if trip already started
// Returns false if passenger is the driver or already joined

// PASSENGER: Leave the trip
Travel_Trip::leave($tripStream, $passengerId);
// Transitions: waiting → canceled, riding → expelled
// Removes passenger coordinates, recalculates route
// Leaves stream (no more notifications)

// DRIVER: Complete the trip
Travel_Trip::completed($tripStream, $driverId);
// Sets all participants to 'arrived', closes stream
// Only publisher can call this

// DRIVER: Discontinue the trip
Travel_Trip::discontinue($tripStream, $driverId);
// Sets all participants to 'discontinued', closes stream
// Closes recurring category if exists
```

---

## 4. Real-Time Coordinate Tracking

```php
// Update a participant's position
Travel_Trip::setCoordinates($tripStream, $userId, array(
    'latitude'  => 40.7135,
    'longitude' => -74.0050,
    'heading'   => 90.0         // optional
));
// Saves to travel_trip.coordinates JSON
// When driver updates position:
//   1. Checks distance to each waiting passenger
//   2. If within 'arriving' distance → posts Travel/trip/arriving
//   3. If within 'pickup' distance → auto-sets passenger to 'riding'
//   4. Checks distance to destination → posts Travel/trip/finishing
//   5. Checks deviation from route polyline
//   6. If deviation > 'route' distance → recalculates route

// Remove coordinates (on leave)
Travel_Trip::setCoordinates($tripStream, $userId, null);
// Removes from JSON and recalculates route

// Read coordinates
$coords = Travel_Trip::getCoordinates($tripStream, $userId);
// Returns: ['latitude' => ..., 'longitude' => ..., 'heading' => ...]

$allCoords = Travel_Trip::getAllCoordinates($tripStream);
// Returns: {userId => {latitude, longitude, heading}, ...}
```

---

## 5. Route Calculation

```php
// Calculate/recalculate route (Google Directions API)
$result = Travel_Trip::route($tripStream, $waypoints, array(
    'travelMode' => 'driving',    // 'driving', 'bicycling', 'transit', 'walking'
    'optimize'   => true,          // optimize waypoint order
    'startTime'  => $timestamp,    // departure time
    'endTime'    => $timestamp     // arrival time (use one or the other)
));
// $waypoints: array of ['userId'=>..., 'location'=>[lat,lon], 'stopover'=>true]
// If $waypoints empty, auto-collects from all waiting passengers' coordinates
// Stores full response in travel_trip.directions
// Builds pickups[] array mapping optimized waypoint order to userIds
// Updates startTime/endTime based on calculated duration
// Returns Google Directions API response with added 'request' and 'pickups'

// Requires: Places.google.keys.server config
```

---

## 6. Querying Trips

```php
// Trips the user is participating in
$streams = Travel_Trip::participating(
    $userId,                    // null = logged-in user
    strtotime('-1 hour'),       // fromTime (earliest endTime)
    strtotime('+1 day'),        // untilTime (latest startTime)
    array('planning', 'driving', 'waiting'),  // state filter (or comma-delimited string)
    array('asUserId' => $userId)
);
// Returns array of Streams_Stream objects

// Get trip's related event
$event = Travel_Trip::getEventByTrip($tripStream);
// Returns Streams_Stream (Calendars/event) or false

// Get participant
$participant = Travel_Trip::participant($tripStream, $userId);
// Returns Streams_Participant (throws if not found)
```

---

## 7. Nearby Notifications

```php
// Sent automatically on trip creation:
Travel_Trip::sendNotifications($tripStream);
// Finds Places/nearby streams within Travel.Trip.distances.subscribe meters
// of the trip's anchor point (origin for Travel/from, destination for Travel/to)
// Posts Travel/trip/added message with venue and link info

// Subscribers to those Places/nearby streams receive the notification
// To subscribe to trips near a location:
Places_Nearby::subscribe($communityId, $latitude, $longitude, $meters);
```

---

## 8. Recurring Trips

```php
// Trips can be recurring via Calendars_Recurring integration
// Pass recurringInfo in Travel_Trip::create():
$result = Travel_Trip::create($userId, array(
    'attributes' => array(/* ... */),
    'recurringInfo' => array(
        'period' => 'weekly',
        'days'   => array('Mon' => array(), 'Fri' => array())
    )
), $eventStream);
// Creates Calendars/recurring category, relates to event's recurring category
// Per-user day preferences stored in recurring participant extras

// When passenger joins/cancels, their recurring participation auto-updates
// via Travel_Trip::changeUserParticipation()
```

---

## 9. Common Mistakes

| Wrong | Right |
|-------|-------|
| Setting participant state directly on `Streams_Participant` | Use `Travel_Trip::setState()` — validates transitions, posts messages, handles recurring |
| Creating trip with `Streams::create()` | Use `Travel_Trip::create()` — handles routing, Places/nearby relations, notifications, recurring |
| Calling `join()` as the driver (publisher) | `join()` is for passengers only; driver uses `start()` |
| Letting passengers join a started trip | `join()` throws `Travel_Exception_TripAlreadyStarted`; by design |
| Updating coordinates without the stream | Always pass the trip stream to `setCoordinates()` — it handles proximity detection and route recalculation |
| Missing `Places.google.keys.server` config | Route calculation requires a Google Directions API key |
| Using `Travel/to` without `endTime` | `Travel/to` requires `endTime`; `Travel/from` requires `startTime` |
| Modifying `travel_trip.directions` directly | Use `Travel_Trip::route()` — it handles waypoint collection, optimization, and time estimates |

---

## 10. Key Schema

### travel_trip (extends Travel/trip streams)
```sql
publisherId  varbinary(31)   PK
streamName   varbinary(255)  PK
directions   mediumtext      NULL  -- full Google Directions API JSON response
coordinates  text            NULL  -- JSON: {userId: {latitude, longitude, heading}}
```

**All other data** is in stream attributes and participant extras:
- **Stream attributes:** from, to, startTime, endTime, state, type, venue, peopleMax, detourMax, detourType, labels, lastPickup
- **Participant extras:** state, startTime, endTime, timestamp, coordinates, gotArrivingNote

---

## 11. Configuration Reference

```
Travel.Trip.arriveTime = 7200          — default arrive window (seconds from now)
Travel.Trip.departTime = 900           — default depart window (seconds from now)
Travel.Trip.distances.route = 100      — meters deviation before route recalculation
Travel.Trip.distances.arriving = 100   — meters from passenger for arriving notification
Travel.Trip.distances.pickup = 10      — meters from passenger for auto-pickup
Travel.Trip.distances.riding = 100     — meters threshold while riding
Travel.Trip.distances.mapZoom = 100    — meters movement before map re-zoom
Travel.Trip.distances.subscribe = 1000 — radius for sending trip-added notifications
```