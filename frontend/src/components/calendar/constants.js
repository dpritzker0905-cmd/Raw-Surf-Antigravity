export var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export var FULL_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export var TIME_SLOTS = [
  '05:00', '06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00',
  '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00'
];

export var getDaysInMonth = (year, month) => {
  return new Date(year, month + 1, 0).getDate();
};

export var getFirstDayOfMonth = (year, month) => {
  return new Date(year, month, 1).getDay();
};
