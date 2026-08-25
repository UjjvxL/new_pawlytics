import type { Sighting } from "./types";

export interface DemoReviewCase {
  id: string;
  reportId: string;
  organizationId: string;
  priority: "high" | "medium" | "low";
  status: "open" | "approved" | "rejected";
  reasonCodes: string[];
  createdAt: Date;
}

export const DEFAULT_DEMO_SIGHTINGS: Sighting[] = [
  {
    id: "demo-kp2-1",
    lat: 28.4635,
    lng: 77.4928,
    sightingTimezone: "Asia/Kolkata",
    description: "Pack of 5 aggressive dogs growling at students exiting IILM University Gate 1 at 8 PM.",
    severity: "high",
    dogCount: 5,
    imageUrl: "https://images.unsplash.com/photo-1548199973-03cce0bbc87b?auto=format&fit=crop&w=800&q=80",
    thumbnailUrl: "https://images.unsplash.com/photo-1548199973-03cce0bbc87b?auto=format&fit=crop&w=300&q=80",
    createdAt: new Date(Date.now() - 3600000 * 2),
    verificationStatus: "review_required",
    observedBehavior: "Aggressive growling pack near campus gate",
    aiConfidence: 0.94,
    privacySafeForPublic: true,
    sharePublicImage: true,
  },
  {
    id: "demo-kp3-2",
    lat: 28.4716,
    lng: 77.4838,
    sightingTimezone: "Asia/Kolkata",
    description: "3 dogs loitering near Sharda Hospital perimeter entrance.",
    severity: "high",
    dogCount: 3,
    imageUrl: "https://images.unsplash.com/photo-1583511655857-d19b40a7a54e?auto=format&fit=crop&w=800&q=80",
    thumbnailUrl: "https://images.unsplash.com/photo-1583511655857-d19b40a7a54e?auto=format&fit=crop&w=300&q=80",
    createdAt: new Date(Date.now() - 3600000 * 5),
    verificationStatus: "review_required",
    observedBehavior: "Resting near hospital food stalls",
    aiConfidence: 0.91,
    privacySafeForPublic: true,
    sharePublicImage: true,
  },
  {
    id: "demo-alpha1-3",
    lat: 28.4741,
    lng: 77.5038,
    sightingTimezone: "Asia/Kolkata",
    description: "4 dogs chased delivery scooter near Alpha 1 Metro Plaza circle.",
    severity: "medium",
    dogCount: 4,
    imageUrl: "https://images.unsplash.com/photo-1537151608828-ea2b11777ee8?auto=format&fit=crop&w=800&q=80",
    thumbnailUrl: "https://images.unsplash.com/photo-1537151608828-ea2b11777ee8?auto=format&fit=crop&w=300&q=80",
    createdAt: new Date(Date.now() - 3600000 * 12),
    verificationStatus: "provisional",
    observedBehavior: "Vehicle chase behavior",
    aiConfidence: 0.88,
    privacySafeForPublic: true,
    sharePublicImage: true,
  },
  {
    id: "demo-stjoseph-4",
    lat: 28.4782,
    lng: 77.5082,
    sightingTimezone: "Asia/Kolkata",
    description: "Group of 3 stray dogs resting peacefully near St. Joseph's School gate.",
    severity: "low",
    dogCount: 3,
    imageUrl: "https://images.unsplash.com/photo-1517849845537-4d257902454a?auto=format&fit=crop&w=800&q=80",
    thumbnailUrl: "https://images.unsplash.com/photo-1517849845537-4d257902454a?auto=format&fit=crop&w=300&q=80",
    createdAt: new Date(Date.now() - 3600000 * 18),
    verificationStatus: "confirmed",
    observedBehavior: "Passive resting",
    aiConfidence: 0.96,
    privacySafeForPublic: true,
  },
  {
    id: "demo-beta1-5",
    lat: 28.4552,
    lng: 77.5142,
    sightingTimezone: "Asia/Kolkata",
    description: "Single stray dog followed evening walker for 150m in Beta 1 Block C.",
    severity: "medium",
    dogCount: 1,
    imageUrl: "https://images.unsplash.com/photo-1561037404-61cd46aa615b?auto=format&fit=crop&w=800&q=80",
    thumbnailUrl: "https://images.unsplash.com/photo-1561037404-61cd46aa615b?auto=format&fit=crop&w=300&q=80",
    createdAt: new Date(Date.now() - 3600000 * 24),
    verificationStatus: "provisional",
    observedBehavior: "Following pedestrians",
    aiConfidence: 0.85,
    privacySafeForPublic: true,
  },
  {
    id: "demo-sec62-6",
    lat: 28.626,
    lng: 77.362,
    sightingTimezone: "Asia/Kolkata",
    description: "Pack of 4 dogs barking at night near Sector 62 Noida IT Park gate.",
    severity: "high",
    dogCount: 4,
    imageUrl: "https://images.unsplash.com/photo-1548199973-03cce0bbc87b?auto=format&fit=crop&w=800&q=80",
    thumbnailUrl: "https://images.unsplash.com/photo-1548199973-03cce0bbc87b?auto=format&fit=crop&w=300&q=80",
    createdAt: new Date(Date.now() - 3600000 * 30),
    verificationStatus: "confirmed",
    observedBehavior: "Territorial barking",
    aiConfidence: 0.92,
    privacySafeForPublic: true,
  },
  {
    id: "demo-sec18-7",
    lat: 28.571,
    lng: 77.326,
    sightingTimezone: "Asia/Kolkata",
    description: "3 dogs near Sector 18 Atta Market street food lane.",
    severity: "medium",
    dogCount: 3,
    imageUrl: "https://images.unsplash.com/photo-1583511655857-d19b40a7a54e?auto=format&fit=crop&w=800&q=80",
    thumbnailUrl: "https://images.unsplash.com/photo-1583511655857-d19b40a7a54e?auto=format&fit=crop&w=300&q=80",
    createdAt: new Date(Date.now() - 3600000 * 36),
    verificationStatus: "confirmed",
    observedBehavior: "Scavenging near food stalls",
    aiConfidence: 0.89,
    privacySafeForPublic: true,
  },
  {
    id: "demo-parichowk-8",
    lat: 28.467,
    lng: 77.498,
    sightingTimezone: "Asia/Kolkata",
    description: "2 dogs near Pari Chowk round-about bus stop.",
    severity: "medium",
    dogCount: 2,
    imageUrl: "https://images.unsplash.com/photo-1517849845537-4d257902454a?auto=format&fit=crop&w=800&q=80",
    thumbnailUrl: "https://images.unsplash.com/photo-1517849845537-4d257902454a?auto=format&fit=crop&w=300&q=80",
    createdAt: new Date(Date.now() - 3600000 * 8),
    verificationStatus: "confirmed",
    observedBehavior: "Loitering near transit point",
    aiConfidence: 0.90,
    privacySafeForPublic: true,
  },
];

export const DEFAULT_DEMO_REVIEWS: DemoReviewCase[] = [
  {
    id: "rev-kp2-1",
    reportId: "demo-kp2-1",
    organizationId: "demo-org",
    priority: "high",
    status: "open",
    reasonCodes: ["group_aggression", "campus_exit", "ai_high_confidence"],
    createdAt: new Date(Date.now() - 3600000 * 2),
  },
  {
    id: "rev-kp3-2",
    reportId: "demo-kp3-2",
    organizationId: "demo-org",
    priority: "high",
    status: "open",
    reasonCodes: ["hospital_perimeter", "waste_point", "pack_sighting"],
    createdAt: new Date(Date.now() - 3600000 * 5),
  },
  {
    id: "rev-alpha1-3",
    reportId: "demo-alpha1-3",
    organizationId: "demo-org",
    priority: "medium",
    status: "open",
    reasonCodes: ["scooter_chase", "metro_plaza"],
    createdAt: new Date(Date.now() - 3600000 * 12),
  },
  {
    id: "rev-beta1-5",
    reportId: "demo-beta1-5",
    organizationId: "demo-org",
    priority: "low",
    status: "open",
    reasonCodes: ["pedestrian_following", "block_park"],
    createdAt: new Date(Date.now() - 3600000 * 24),
  },
];

const DEMO_IMAGES = [
  "https://firebasestorage.googleapis.com/v0/b/pawlytics-506516.firebasestorage.app/o/publicEvidence%2F0b3f64bea0bc3e19833ef4881dd0f899%2Fthumbnail.jpg?alt=media",
  "https://firebasestorage.googleapis.com/v0/b/pawlytics-506516.firebasestorage.app/o/publicEvidence%2Fb88bea047af0b63ca8220aa3c3659fa9%2Fthumbnail.jpg?alt=media",
  "https://firebasestorage.googleapis.com/v0/b/pawlytics-506516.firebasestorage.app/o/publicEvidence%2Fedd9e1cded6aed3fa5b050e556cee81f%2Fthumbnail.jpg?alt=media",
];

const NCR_DEMO_AREAS = [
  ["IILM University, Knowledge Park II", 28.4589, 77.4947],
  ["Knowledge Park II Metro", 28.4644, 77.4895],
  ["Knowledge Park III", 28.4722, 77.4838],
  ["Pari Chowk", 28.4657, 77.5108],
  ["Alpha I", 28.4724, 77.5102],
  ["Alpha II", 28.4781, 77.5176],
  ["Beta I", 28.4594, 77.5203],
  ["Beta II", 28.4527, 77.5271],
  ["Gamma I", 28.4819, 77.5252],
  ["Gamma II", 28.4882, 77.5309],
  ["Delta I", 28.4893, 77.5399],
  ["Greater Noida West", 28.5793, 77.4316],
  ["Noida Sector 62", 28.6261, 77.3654],
  ["Noida Sector 18", 28.5708, 77.3261],
  ["Botanical Garden", 28.5641, 77.3343],
  ["South East Delhi", 28.5355, 77.2582],
] as const;

const DEMO_BEHAVIOURS = [
  ["calm", "resting beside a shaded footpath"],
  ["roaming", "moving between the service lane and pavement"],
  ["alert", "barking when pedestrians pass the waste point"],
  ["following", "following walkers for a short distance"],
  ["territorial", "guarding a food stall and nearby lane"],
] as const;

const JUDGE_ROUTE = {
  start: { lat: 28.4589, lng: 77.4947 },
  end: { lat: 28.4657, lng: 77.5108 },
};

function distanceFromJudgeCorridor(lat: number, lng: number) {
  const { start, end } = JUDGE_ROUTE;
  const dx = end.lat - start.lat;
  const dy = end.lng - start.lng;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((lat - start.lat) * dx + (lng - start.lng) * dy) /
        (dx * dx + dy * dy),
    ),
  );
  return Math.hypot(
    lat - (start.lat + t * dx),
    lng - (start.lng + t * dy),
  ) * 111_000;
}

/**
 * A deterministic, client-only scale dataset. Two reports form each 250 m
 * hotspot so the map exercises aggregation and the evidence carousel without
 * writing fake reports to production Firestore or awarding incentive points.
 */
export const NCR_SCALE_DEMO_SIGHTINGS: Sighting[] = NCR_DEMO_AREAS.flatMap(
  ([area, areaLat, areaLng], areaIndex) =>
    Array.from({ length: 15 }, (_, hotspotIndex) => {
      const row = Math.floor(hotspotIndex / 5) - 1;
      const column = (hotspotIndex % 5) - 2;
      let lat = areaLat + row * 0.0049 + (areaIndex % 2) * 0.00035;
      let lng = areaLng + column * 0.0053 + (hotspotIndex % 2) * 0.00025;
      // Keep a single obvious obstruction on the IILM → Pari Chowk shortest
      // path and move other local demo clusters outside its safe corridor.
      if (areaIndex === 0 && hotspotIndex === 0) {
        lat = 28.45895;
        lng = 77.5027;
      } else if (areaIndex < 8 && distanceFromJudgeCorridor(lat, lng) < 700) {
        lat += hotspotIndex % 2 ? 0.009 : -0.009;
      }
      const totalDogs = [3, 6, 4, 7][(areaIndex + hotspotIndex) % 4];
      const [behavior, detail] =
        DEMO_BEHAVIOURS[(areaIndex * 3 + hotspotIndex) % DEMO_BEHAVIOURS.length];
      return [0, 1].map((reportIndex): Sighting => {
        const dogCount =
          reportIndex === 0 ? Math.ceil(totalDogs / 2) : Math.floor(totalDogs / 2);
        const image =
          DEMO_IMAGES[(areaIndex + hotspotIndex + reportIndex) % DEMO_IMAGES.length];
        return {
          id: `ncr-demo-${areaIndex}-${hotspotIndex}-${reportIndex}`,
          lat: lat + (reportIndex ? 0.00032 : -0.00032),
          lng: lng + (reportIndex ? -0.00024 : 0.00024),
          sightingTimezone: "Asia/Kolkata",
          description: `${dogCount} community dog${dogCount === 1 ? "" : "s"} ${detail} near ${area}.`,
          severity: totalDogs >= 5 ? "high" : "medium",
          dogCount,
          imageUrl: image,
          thumbnailUrl: image,
          createdAt: new Date(
            Date.now() -
              ((areaIndex * 15 + hotspotIndex) * 11 + reportIndex * 7 + 8) *
                60_000,
          ),
          expiresAt: new Date(Date.now() + 48 * 3_600_000),
          verificationStatus: reportIndex ? "confirmed" : "provisional",
          observedBehavior: behavior,
          aiSummary: `AI verified ${dogCount} visible dog${dogCount === 1 ? "" : "s"} ${detail}.`,
          aiConfidence: 0.86 + ((areaIndex + hotspotIndex) % 11) / 100,
          locationEvidence: "GPS + visual landmark match",
          privacySafeForPublic: true,
          sharePublicImage: true,
          testOnly: true,
        };
      });
    }).flat(),
);

export const NCR_DEMO_STATS = {
  reports: NCR_SCALE_DEMO_SIGHTINGS.length,
  hotspots: NCR_DEMO_AREAS.length * 15,
  dogs: NCR_SCALE_DEMO_SIGHTINGS.reduce(
    (total, report) => total + (report.dogCount || 1),
    0,
  ),
};

export const NCR_DEMO_DESTINATIONS = [
  { label: "Pari Chowk", lat: 28.4657, lng: 77.5108 },
  { label: "Knowledge Park II Metro", lat: 28.4644, lng: 77.4895 },
  { label: "Alpha I Commercial Belt", lat: 28.4724, lng: 77.5102 },
] as const;
