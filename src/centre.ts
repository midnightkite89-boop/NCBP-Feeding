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
  features: {
    ferrets: false,
    /** GPS flight logs (Marshall AeroVision) */
    gpsFlights: false,
    /** Experience / display sessions with several birds */
    sessions: false,
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
