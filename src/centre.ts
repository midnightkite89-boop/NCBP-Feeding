// Everything that differs between centres. Each centre's copy of the app sets these once.

export const CENTRE = {
  name: 'National Centre for Birds of Prey',
  shortName: 'NCBP',
  appName: 'NCBP Bird Care',
  brand: '#872250',
  /** Used only for the frost warning; only these fixed coordinates are sent. Duncombe Park, Helmsley (approximate). */
  lat: 54.235,
  lon: -1.07,
  defaultDisinfectant: 'F10',
  /** Foods on the menu after the usual six */
  extraFoods: ['Mackerel', 'Trout', 'Squirrel'],
  /** Cuts offered for the bigger foods (replaces the standard list where given) */
  foodParts: { Rabbit: ['portion', 'whole'] } as Record<string, readonly string[]>,
  /** Flight types offered, in the order staff reach for them, with this centre's names */
  flightTypes: [
    { value: 'display', label: 'Demonstration' },
    { value: 'experience', label: 'Experience' },
    { value: 'training', label: 'Training' },
    { value: 'evening', label: 'Owl evening' },
    { value: 'other', label: 'Other' },
  ] as { value: 'display' | 'experience' | 'training' | 'school' | 'evening' | 'other'; label: string }[],
  /** Hint in the session note box (NCBP doesn't record customer names) */
  sessionNoteHint: 'Optional',
  features: {
    ferrets: false,
    /** GPS flight logs (Marshall AeroVision) */
    gpsFlights: true,
    /** Experience / display sessions with several birds */
    sessions: true,
    /** Today's demonstration timetable: birds added to set times on the day, one tap to log */
    timetable: true,
    /** Shows, schools and parties with R6–R8 forms */
    outings: false,
    /** UK Animal Activity Licence forms (R1–R5) */
    aalForms: false,
    /** Copying photos and doses into a Google Drive folder per bird */
    driveSync: false,
    /** Food left over, logged per bird with a trend flag */
    leftovers: true,
    /** Breeding aviaries: nest checks, eggs, hatchings */
    breeding: true,
    /** A daily "checked" for every bird (FED counts as one); off = not shown or counted */
    dailyChecks: false,
    /** Twice-yearly hands-on checks for breeding / aviary birds: coped, weighed, condition scored */
    checkups: true,
  },
} as const;

export const has = (f: keyof typeof CENTRE.features) => CENTRE.features[f];
