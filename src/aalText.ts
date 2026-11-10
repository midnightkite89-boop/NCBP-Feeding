// Wording copied from SMJ's own AAL forms (AAL folder), so the printed versions match them.

export const GUIDANCE = {
  "r1": [
    "You must provide your Local Authority with a list of raptors exhibited which will then show on your license",
    "This form may be used to record the number and type of raptors exhibited and their use",
    "Any new types of raptors acquired for exhibition that are not specified on the licence, or where the number of a particular type of raptor exceeds the number on the licence, must be notified in writing to the Local Authority and an up to date list provided",
    "The number of raptors kept for the activity at any time must not exceed the maximum that is reasonable taking into account the facilities and staffing on any premises used for the licensable activity."
  ],
  "r2": [
    "This form is completed and maintained for each individual raptor listed on your Animals Activities License",
    "If any of the information required is unknown the reason for that must be documented",
    "The behaviour of individual raptors is monitored daily and any changes in behaviour and/or behaviours indicative of stress, fear, pain and anxiety must be recorded and acted upon",
    "If housed with others this raptor must be monitored to ensure access to resources via the Daily Inspection Record Sheet",
    "If this raptor does not require vaccinations, worming or parasite treatment this must be stated. Note that vaccines must be licensed for use in the UK. You are advised to keep your raptor’s vaccination and other medical records with this document."
  ],
  "r4": [
    "You must register with a veterinarian with an appropriate level of experience in the health and welfare requirements of raptors",
    "Contact details of that veterinarian must be readily available to all staff on the premises used for the licensable activity",
    "The veterinary practice must be within a reasonable travel distance",
    "The veterinary practice should assess their competence to act in relation to each species and, if knowledge is lacking in any area, help to make arrangements for access to specialist knowledge such as a competent secondary veterinary practice should the need arise for any specific species. You must provide information relating to any arrangement like this for each species held to demonstrate veterinary competence for those raptors."
  ],
  "r5": [
    "Use this form to help you to conduct an assessment of your raptor accommodation",
    "This will help you to identify any gaps in meeting the regulations and associated guidance relating to accommodation",
    "Where there are gaps or non-compliances, state what actions you will take to address these and make sure that you complete these actions",
    "Accommodation must allow each raptor to express natural behaviours",
    "Areas, equipment and appliances to which the raptors have access must present minimal risks of injury, illness and escape",
    "They must be constructed in materials that are robust, safe and durable, in a good state of repair and well maintained.",
    "Accommodation must be regularly inspected for damage and potential injury or escape points",
    "Damaged accommodation must be repaired or replaced immediately"
  ],
  "r6": [
    "Complete for each exhibition",
    "Applies to any exhibition on or off-site",
    "The number of raptor handlers will be consistent with the number and species of raptors being used",
    "All raptors are suitable for the type of exhibition, enclosure and actions involved having been trained and acclimatised to the conditions (including any handling, noise, lighting, special effects, other raptors)",
    "All raptors are able to have their needs met and are not likely to be nervous, stressed or fearful.",
    "Raptors showing signs of aggression, fear or distress will not be used in an exhibit",
    "Whilst being temporarily exhibited, enclosure sizes that are smaller than that considered best practice for long term husbandry can be used",
    "Temporary accommodation allows for a range of movement and natural behaviours; allows raptors to be able to control their visual access to surroundings and raptors in other enclosures and minimises the number of raptors that staff disturb when removing any individual raptor"
  ],
  "r8": [
    "Complete one of these forms for each journey",
    "Ensure that you follow the associated Transport Policy and undertake checks in accordance with the checklist in that document",
    "Where there is an accident during the transport of raptors the driver of the vehicle must complete the Accident Record Form as soon as practicably possible following the accident"
  ]
} as const;

export type R5Item = { heading: string } | { key: string; text: string };

export const R5_ITEMS: R5Item[] = [
  {
    "heading": "Construction"
  },
  {
    "key": "r0",
    "text": "Timber is of good quality, well-kept and any damaged areas sealed or over clad"
  },
  {
    "key": "r1",
    "text": "Wood is smooth and treated and properly maintained"
  },
  {
    "key": "r2",
    "text": "Where appropriate, interior surfaces, including floors, are smooth, impervious and able to be disinfected"
  },
  {
    "key": "r3",
    "text": "Floors have a non-slip, solid surface"
  },
  {
    "key": "r4",
    "text": "Junctions between sections are coved or sealed"
  },
  {
    "key": "r5",
    "text": "There are no sharp edges, projections, rough edges or other hazards which present risk of injury to any raptor"
  },
  {
    "key": "r6",
    "text": "No unprotected electrical cables are within reach of any raptor"
  },
  {
    "key": "r7",
    "text": "Materials are non-toxic"
  },
  {
    "key": "r8",
    "text": "Windows are escape-proof"
  },
  {
    "key": "r9",
    "text": "Doors are strong enough to resist impact, scratching and chewing, and are capable of being effectively secured"
  },
  {
    "key": "r10",
    "text": "Contains perches that not have the potential to cause injury and are replaced if damaged"
  },
  {
    "key": "r11",
    "text": "There are no large apertures/ holes"
  },
  {
    "key": "r12",
    "text": "Door openings are constructed such that the passage of water/waste is not impeded, or allowed to gather due to inaccessibility"
  },
  {
    "key": "r13",
    "text": "Where metal bars and/or mesh and/or frames are used, they are of suitable gauge with spacing adequate to prevent raptors escaping or becoming entrapped"
  },
  {
    "key": "r14",
    "text": "Care is taken where aviaries or cages are constructed of newly galvanised mesh to prevent heavy metal poisoning"
  },
  {
    "key": "r15",
    "text": "Drainage is effective to ensure there is no standing or pooling of liquids"
  },
  {
    "key": "r16",
    "text": "Waste water does not run off into adjacent pens/ units"
  },
  {
    "key": "r17",
    "text": "Drainage channels are provided"
  },
  {
    "key": "r18",
    "text": "Where appropriate, accommodation opens onto secure corridors or secure areas so that raptors are not able to escape from the premises (Note: corridors must not be used as exercise areas)."
  },
  {
    "key": "r19",
    "text": "The enclosure size is appropriate to the species to be housed"
  },
  {
    "key": "r20",
    "text": "Ventilation is provided to all interior areas, as appropriate to the species and have no detrimental effect on temperature or humidity"
  },
  {
    "key": "r21",
    "text": "Unintended heat sources are avoided. This may include exposure to excessive direct sunlight"
  },
  {
    "key": "r22",
    "text": "Where tiered accommodation systems are utilised, water, food or waste products are not allowed to contaminate lower levels"
  },
  {
    "key": "r23",
    "text": "In certain systems, such as mixed-species aviaries, where isolation is inappropriate, waste is adequately managed to prevent contamination of food and water"
  },
  {
    "key": "r24",
    "text": "Noise disturbance is minimised and demonstrable mitigating steps taken where problems arise"
  },
  {
    "key": "r25",
    "text": "Where appropriate raptors are not exposed to draughts"
  },
  {
    "key": "r26",
    "text": "Light is provided in a suitable light: dark cycle for the species and where natural light is insufficient, suitable artificial lighting must be used (Note: raptors must be exposed to sufficient direct natural light to promote vitamin and mineral take-up)"
  },
  {
    "key": "r27",
    "text": "Enclosures must allow for visual inspection with minimal disturbance to the animal"
  },
  {
    "key": "r28",
    "text": "Lights must be turned off to provide a period of darkness overnight unless the species requirements specify otherwise."
  },
  {
    "key": "r29",
    "text": "Consideration must be given to the specific requirements of nocturnal species"
  },
  {
    "key": "r30",
    "text": "External door is lockable"
  },
  {
    "heading": "Accommodation:"
  },
  {
    "key": "r31",
    "text": "Provides suitable protection from adverse weather conditions"
  },
  {
    "key": "r32",
    "text": "Is regularly inspected for damage and potential injury or escape points"
  },
  {
    "key": "r33",
    "text": "Is secure (predator proof, escape proof and lockable)"
  },
  {
    "key": "r34",
    "text": "Is clean and free from parasites (and vermin)"
  },
  {
    "key": "r35",
    "text": "Is free from hazards (e.g. sharp projections and edges)"
  },
  {
    "key": "r36",
    "text": "Is sheltered from extremes of weather"
  },
  {
    "key": "r37",
    "text": "Is at a temperature suitable to the species of raptor"
  },
  {
    "key": "r38",
    "text": "Contains a suitable amount of clean bedding material of a type suitable for the species"
  },
  {
    "key": "r39",
    "text": "Allows raptors to lie fully stretched out"
  },
  {
    "key": "r40",
    "text": "Allows raptors to stand in their natural posture"
  },
  {
    "key": "r41",
    "text": "Allows raptors to move around freely climb and jump where appropriate, and be comfortable in their environment;"
  },
  {
    "key": "r42",
    "text": "Allows raptors to rest comfortably"
  },
  {
    "key": "r43",
    "text": "Allows raptors to hide from human view or other raptors in the enclosure, where appropriate; be kept in appropriate social groups;"
  },
  {
    "key": "r44",
    "text": "Allows raptors to where appropriate, have separate areas for sleeping, toileting, exercising and the ability to move away from the social group"
  },
  {
    "key": "r45",
    "text": "Allows raptors to hide from potentially frightening stimuli"
  },
  {
    "key": "r46",
    "text": "Allows raptors to move away from direct lighting"
  },
  {
    "key": "r47",
    "text": "Contains environmental enrichment"
  },
  {
    "key": "r48",
    "text": "Access to fire extinguisher within reasonable distance"
  },
  {
    "heading": "Maintenance"
  },
  {
    "key": "r49",
    "text": "All wire mesh/fencing is kept in good repair to provide an escape and dig proof structure"
  },
  {
    "key": "r50",
    "text": "The enclosure size is adjusted according to its size as the raptor grows"
  },
  {
    "key": "r51",
    "text": "Damaged accommodation is repaired or replaced immediately"
  },
  {
    "key": "r52",
    "text": "Accommodation is regularly inspected"
  },
  {
    "heading": "Complete this section for raptors that share accommodation. This is to ensure that sufficient resources are available so that each individual raptor can:"
  },
  {
    "key": "r53",
    "text": "Perch at the same time as the other raptors in the enclosure"
  },
  {
    "key": "r54",
    "text": "Feed at the same time as the other raptors in the enclosure"
  },
  {
    "key": "r55",
    "text": "Separate off from the other raptors in the enclosure"
  },
  {
    "key": "r56",
    "text": "Access water at the same time as the other raptors in the enclosure"
  },
  {
    "key": "r57",
    "text": "Access enrichment items at the same time as the other raptors in the enclosure"
  },
  {
    "key": "r58",
    "text": "Access a comfortable resting area that all raptors housed together can use at the same time"
  },
  {
    "key": "r59",
    "text": "Be isolated to ascertain whether it is eating or not"
  }
];
