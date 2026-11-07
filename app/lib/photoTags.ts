// Photo tags for the G'Day Tigers album (Paul's gallery pool).
// Our own six tags drive the Daily Story filter; each one maps onto a Google
// Business Profile photo category so a tagged photo can be posted to Google
// with the right category. Keep in sync with STORY_CATS in apps-script-gbp/GbpStoryPhotos.js.

export const PHOTO_TAGS = [
  { key: 'COFFEE',  label: 'Coffee',  google: 'FOOD_AND_DRINK', hint: 'coffee is the subject: lattes, espresso, pour-overs, latte art, beans, the machine pouring a shot' },
  { key: 'FOOD',    label: 'Food',    google: 'FOOD_AND_DRINK', hint: 'food or other drinks are the subject: sandwiches, pastries, cabinet shots, juices, iced drinks — anything edible that is not a parma' },
  { key: 'PARMA',   label: 'Parma',   google: 'FOOD_AND_DRINK', hint: 'a chicken parma / parmigiana sandwich or roll (crumbed chicken, tomato sauce, melted cheese) is the subject' },
  { key: 'INSIDE',  label: 'Inside',  google: 'INTERIOR',       hint: 'inside the café with no food, drink or person as the subject: the room, counter, seating, shelves, cups, decor' },
  { key: 'OUTSIDE', label: 'Outside', google: 'EXTERIOR',       hint: 'the shopfront, signage, street or anything outdoors' },
  { key: 'TEAM',    label: 'Team',    google: 'TEAMS',          hint: 'people are the subject: staff posing or working (making coffee, cooking, serving) and customers' },
] as const;

export type PhotoTag = (typeof PHOTO_TAGS)[number]['key'];
export const PHOTO_TAG_KEYS: readonly string[] = PHOTO_TAGS.map(t => t.key);
export const isPhotoTag = (v: unknown): v is PhotoTag => typeof v === 'string' && PHOTO_TAG_KEYS.includes(v);
export const googleCategoryFor = (tag: string) => PHOTO_TAGS.find(t => t.key === tag)?.google ?? 'ADDITIONAL';
