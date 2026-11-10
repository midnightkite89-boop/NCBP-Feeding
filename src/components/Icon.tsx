import {
  IconAlertTriangle,
  IconBath,
  IconBuildingWarehouse,
  IconBus,
  IconCalendarWeek,
  IconCamera,
  IconClipboardList,
  IconCompass,
  IconDots,
  IconFeather,
  IconFolder,
  IconHistory,
  IconLayoutCards,
  IconLayoutColumns,
  IconList,
  IconMapPin,
  IconMeat,
  IconPaw,
  IconPencil,
  IconPhone,
  IconPill,
  IconPlaneTilt,
  IconQrcode,
  IconRoute,
  IconRulerMeasure,
  IconScale,
  IconSettings,
  IconSnowflake,
  IconSpray,
  IconStethoscope,
  IconTarget,
  IconToolsKitchen2,
  IconUpload,
  IconUsers,
} from '@tabler/icons-react';

// Line icons (Tabler, MIT) in place of emoji. Bundled with the app, so they show offline.
const ICONS = {
  food: IconToolsKitchen2,
  weigh: IconScale,
  clean: IconSpray,
  more: IconDots,
  ferret: IconPaw,
  round: IconCompass,
  fly: IconPlaneTilt,
  left: IconMeat,
  concern: IconAlertTriangle,
  target: IconTarget,
  request: IconPencil,
  health: IconStethoscope,
  meds: IconPill,
  history: IconHistory,
  photo: IconCamera,
  bath: IconBath,
  frost: IconSnowflake,
  folder: IconFolder,
  compare: IconLayoutColumns,
  cards: IconLayoutCards,
  rows: IconList,
  checkup: IconRulerMeasure,
  phone: IconPhone,
  bird: IconFeather,
  aviary: IconBuildingWarehouse,
  route: IconRoute,
  upload: IconUpload,
  qr: IconQrcode,
  calendar: IconCalendarWeek,
  settings: IconSettings,
  staff: IconUsers,
  gps: IconMapPin,
  outing: IconBus,
  sheet: IconClipboardList,
} as const;

export type IconName = keyof typeof ICONS;

/** An inline line icon that sits on the text baseline and takes the text colour */
export function I({ n, size = 18, className = '' }: { n: IconName; size?: number; className?: string }) {
  const C = ICONS[n];
  return <C size={size} stroke={1.75} aria-hidden="true" className={`ic ${className}`.trim()} />;
}

/** An icon in a small plum square, for menu rows */
export function IconTile({ n }: { n: IconName }) {
  return (
    <span className="ic-tile" aria-hidden="true">
      <I n={n} size={19} />
    </span>
  );
}
