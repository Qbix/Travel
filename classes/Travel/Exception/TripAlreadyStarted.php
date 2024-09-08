<?php

/**
 * @module Users
 */
class Travel_Exception_TripAlreadyStarted extends Q_Exception
{
	/**
	 * Complains that the trip already started
	 * @class Travel_Exception_TripAlreadyStarted
	 * @constructor
	 * @extends Q_Exception
	 */
};

Q_Exception::add('Travel_Exception_TripAlreadyStarted', 'The trip already started');
