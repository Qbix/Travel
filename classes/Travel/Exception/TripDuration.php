<?php

/**
 * @module Users
 */
class Travel_Exception_TripDuration extends Q_Exception
{
	/**
	 * An exception is raised if trip will take too long
	 * @class Travel_Exception_TripDuration
	 * @constructor
	 * @extends Q_Exception
	 */
};

Q_Exception::add('Travel_Exception_TripDuration', 'This would make the trip take too long.');
