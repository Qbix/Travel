<?php

function Travel_trips_response_dialog ($params)
{
	Q_Response::setSlot('title', "Related trips");
	return Q::event('Travel/trips/response/content');
}