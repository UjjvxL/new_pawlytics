export const DEMO_DISTRICTS = [
  { name: "Gautam Buddh Nagar", score: 91, dogs: 38420, reports: 1248, bites: 183, sterilized: 72, vaccinated: 81, response: 18, trend: -16 },
  { name: "New Delhi", score: 87, dogs: 29650, reports: 982, bites: 146, sterilized: 68, vaccinated: 77, response: 22, trend: -11 },
  { name: "South East Delhi", score: 82, dogs: 33780, reports: 1104, bites: 214, sterilized: 64, vaccinated: 73, response: 27, trend: -7 },
  { name: "Ghaziabad", score: 74, dogs: 41890, reports: 1376, bites: 298, sterilized: 55, vaccinated: 66, response: 34, trend: 4 },
  { name: "East Delhi", score: 69, dogs: 36540, reports: 1167, bites: 271, sterilized: 49, vaccinated: 61, response: 39, trend: 9 },
  { name: "Faridabad", score: 63, dogs: 44720, reports: 1432, bites: 337, sterilized: 43, vaccinated: 56, response: 46, trend: 13 },
] as const;

export const DEMO_INCIDENTS = [
  { id: "INC-2841", area: "IILM University Gate 1", type: "Pack aggression", severity: "critical", dogs: 7, age: "4 min", source: "Citizen + CCTV", confidence: 96, team: "Unassigned", image: "/demo/dogs/street-dog-1.webp" },
  { id: "BITE-921", area: "Pari Chowk bus bay", type: "Category III bite", severity: "critical", dogs: 1, age: "9 min", source: "Sharda Hospital", confidence: 99, team: "Rapid-04", image: "/demo/dogs/street-dog-2.webp" },
  { id: "INC-2837", area: "Knowledge Park II Metro", type: "Vehicle chase", severity: "high", dogs: 4, age: "17 min", source: "3 citizens", confidence: 93, team: "ABC-12", image: "/demo/dogs/street-dog-3.webp" },
  { id: "INC-2829", area: "Alpha 1 market", type: "Food-source congregation", severity: "medium", dogs: 11, age: "31 min", source: "AI cluster", confidence: 89, team: "Sanitation-07", image: "/demo/dogs/street-dog-4.webp" },
  { id: "INC-2821", area: "Beta 2 Block C", type: "Injured dog", severity: "medium", dogs: 1, age: "46 min", source: "Citizen", confidence: 91, team: "Rescue-03", image: "/demo/dogs/street-dog-5.webp" },
] as const;

export const DEMO_CARE_NETWORK = [
  { name: "Sharda Hospital ARV Centre", type: "Human bite care", distance: "1.8 km", status: "Open", capacity: "14 ARV doses", eta: "8 min" },
  { name: "Govt Veterinary Hospital Kasna", type: "Veterinary hospital", distance: "3.2 km", status: "Open", capacity: "6 kennels free", eta: "12 min" },
  { name: "GIMS Emergency", type: "Human bite care", distance: "4.1 km", status: "Busy", capacity: "31 ARV doses", eta: "16 min" },
  { name: "KARE Trust Response Unit", type: "Rescue NGO", distance: "5.4 km", status: "Open", capacity: "2 vans ready", eta: "19 min" },
  { name: "Vetic Greater Noida", type: "Pet hospital", distance: "7.7 km", status: "Open", capacity: "24×7 emergency", eta: "24 min" },
] as const;

export const DEMO_TEAMS = [
  { name: "Rapid-04", task: "Bite animal observation", area: "Pari Chowk", progress: 74, eta: "6 min" },
  { name: "ABC-12", task: "Pack capture & tagging", area: "Knowledge Park II", progress: 48, eta: "11 min" },
  { name: "Rescue-03", task: "Injured dog pickup", area: "Beta 2", progress: 31, eta: "18 min" },
  { name: "Sanitation-07", task: "Waste hotspot clearance", area: "Alpha 1", progress: 63, eta: "14 min" },
] as const;

export const DEMO_WEEKS = [42, 48, 45, 61, 58, 72, 68, 81, 76, 88, 94, 86] as const;
