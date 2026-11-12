// Off the Map — locations and the jobs dealt to crew players there.
// Add a location by adding an entry; 8 jobs is the target (jobs repeat if a group is bigger).

const LOCATIONS = [
  { name: 'Airplane', jobs: ['Pilot', 'Co-pilot', 'Flight attendant', 'First-class passenger', 'Air marshal', 'Mechanic', 'Economy passenger', 'Parent with a crying baby'] },
  { name: 'Hospital', jobs: ['Surgeon', 'Nurse', 'Patient', 'Paramedic', 'Receptionist', 'Intern', 'Visitor', 'Janitor'] },
  { name: 'Casino', jobs: ['Dealer', 'Pit boss', 'High roller', 'Bartender', 'Security guard', 'Card counter', 'Tourist', 'Cocktail server'] },
  { name: 'Movie Theatre', jobs: ['Projectionist', 'Ticket seller', 'Popcorn vendor', 'Usher', 'Film critic', 'Couple on a date', 'Teenager', 'Manager'] },
  { name: 'Cruise Ship', jobs: ['Captain', 'Bartender', 'Entertainer', 'Cook', 'Deckhand', 'Honeymooner', 'Retired passenger', 'Lifeguard'] },
  { name: 'Hockey Arena', jobs: ['Goalie', 'Referee', 'Zamboni driver', 'Coach', 'Fan', 'Hot dog vendor', 'Team trainer', 'Announcer'] },
  { name: 'Police Station', jobs: ['Detective', 'Desk sergeant', 'Suspect', 'Lawyer', 'Rookie cop', 'Journalist', 'Witness', 'Police chief'] },
  { name: 'High School', jobs: ['Teacher', 'Principal', 'Student', 'Janitor', 'Lunch lady', 'Gym teacher', 'Guidance counsellor', 'Substitute teacher'] },
  { name: 'Bank', jobs: ['Teller', 'Branch manager', 'Security guard', 'Customer', 'Loan officer', 'Robber', 'Armoured truck driver', 'Accountant'] },
  { name: 'Restaurant', jobs: ['Head chef', 'Waiter', 'Dishwasher', 'Food critic', 'Host', 'Customer', 'Line cook', 'Owner'] },
  { name: 'Beach', jobs: ['Lifeguard', 'Surfer', 'Ice cream vendor', 'Tourist', 'Volleyball player', 'Photographer', 'Kid building a sandcastle', 'Sunbather'] },
  { name: 'Space Station', jobs: ['Commander', 'Engineer', 'Scientist', 'Medical officer', 'Space tourist', 'Pilot', 'Alien researcher', 'Mission control liaison'] },
  { name: 'Supermarket', jobs: ['Cashier', 'Stock clerk', 'Butcher', 'Shopper', 'Store manager', 'Baker', 'Security guard', 'Delivery driver'] },
  { name: 'Wedding', jobs: ['Bride', 'Groom', 'Best man', 'Maid of honour', 'Photographer', 'DJ', 'Wedding planner', 'Uninvited guest'] },
  { name: 'Hotel', jobs: ['Front desk clerk', 'Bellhop', 'Housekeeper', 'Concierge', 'Guest', 'Hotel manager', 'Room service waiter', 'Valet'] },
  { name: 'Pirate Ship', jobs: ['Captain', 'First mate', 'Cook', 'Navigator', 'Prisoner', 'Cannoneer', 'Lookout', 'Parrot keeper'] },
  { name: 'Zoo', jobs: ['Zookeeper', 'Veterinarian', 'Tour guide', 'Visitor', 'Ticket seller', 'Photographer', 'Snack vendor', 'Researcher'] },
  { name: 'Gym', jobs: ['Personal trainer', 'Bodybuilder', 'Front desk staff', 'Yoga instructor', 'New member', 'Cleaner', 'Gym manager', 'Spin instructor'] },
  { name: 'Office', jobs: ['Boss', 'Intern', 'IT guy', 'Receptionist', 'Accountant', 'Salesperson', 'HR manager', 'Janitor'] },
  { name: 'Military Base', jobs: ['General', 'Soldier', 'Medic', 'Sniper', 'Cook', 'Pilot', 'Radio operator', 'New recruit'] },
  { name: 'Ski Resort', jobs: ['Ski instructor', 'Snowboarder', 'Lift operator', 'Ski patrol', 'Beginner skier', 'Chalet cook', 'Bartender', 'Rental shop worker'] },
  { name: 'Circus', jobs: ['Ringmaster', 'Clown', 'Acrobat', 'Lion tamer', 'Juggler', 'Magician', 'Ticket seller', 'Audience member'] },
  { name: 'Passenger Train', jobs: ['Conductor', 'Engineer', 'Ticket inspector', 'Passenger', 'Food cart attendant', 'Commuter', 'Tourist', 'Stowaway'] },
  { name: 'Art Museum', jobs: ['Curator', 'Security guard', 'Tour guide', 'Art student', 'Tourist', 'Restorer', 'Gift shop clerk', 'Art thief'] },
  { name: 'Haunted House', jobs: ['Ghost hunter', 'Actor in costume', 'Teenager on a dare', 'Tour guide', 'Owner', 'Psychic', 'Scared visitor', 'Ticket taker'] },
  { name: 'Farm', jobs: ['Farmer', 'Farmhand', 'Veterinarian', 'Tractor driver', 'Visitor', 'Beekeeper', 'Market seller', 'Kid on a field trip'] },
  { name: 'Rock Concert', jobs: ['Lead singer', 'Drummer', 'Sound tech', 'Security', 'Superfan', 'Roadie', 'Merch seller', 'Opening act'] },
  { name: 'Car Dealership', jobs: ['Salesperson', 'Sales manager', 'Mechanic', 'Customer', 'Finance manager', 'Car washer', 'Receptionist', 'Test driver'] },
  { name: 'Fire Station', jobs: ['Fire chief', 'Firefighter', 'Rookie', 'Dispatcher', 'Paramedic', 'Truck driver', 'Visitor on a tour', 'Dog handler'] },
  { name: 'Library', jobs: ['Librarian', 'Student', 'Book club member', 'Visiting author', 'Security guard', 'Kid at story time', 'Researcher', 'Late-fee collector'] }
];

module.exports = { LOCATIONS };
