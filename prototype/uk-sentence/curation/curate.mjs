// Word-list curation for the UK 5-word sentence codec.
//
// Pipeline: raw data (Brysbaert concreteness + Warriner valence + LDNOOBW)
//   → mechanical filters (spelling, safety categories)
//   → frequency-ordered candidate pool
//   → HAND-CURATED drop/add/keep lists below (the craft — every word here was
//     reviewed by a human-ish eye; edit these sets to veto or add words)
//   → phonetic-distinctness prune within each slot
//   → cross-list dedupe, prime trim, capacity check
//   → writes ../nouns.json ../adjectives.json ../verbs.json
//
// Word criteria (see ../README.md): concrete & picturable (nouns), common,
// neutral-to-positive, 3–9 letters, UK spelling, phonetically distinct,
// spellable on hearing, no homophone clashes, and — specific to this product —
// the sentence must never accidentally narrate an emergency: no people, body
// parts, injuries, weapons, rescue vocabulary, weather events, or terrain
// words a caller might use literally in a 999 call ("cliff", "river", "fire").
//
// Data files: set WORDLIST_DATA to a dir containing conc.tsv, warriner.csv,
// badwords.txt, en_50k.txt (fetch commands in ../README.md).
//
// 23 Jul 2026 pass: adjectives and verbs previously had NO commonness signal —
// nouns were windowed to the top-2400-by-frequency concrete pool, but ADJ was
// an explicit hand-picked keep-list and VERB an alphabetical seed, so literary
// words (medieval, glamorous, orderly, cosmic) and kitchen-jargon verbs
// (garnishes, chisels) slipped in. Fix: adjectives now get the same
// frequency-window treatment as nouns, scored against everyday spoken-English
// frequency (OpenSubtitles-derived, en_50k.txt — closer to "words people
// actually say" than book-corpus frequency). Verbs are the OPPOSITE problem:
// their 3rd-person -s form is inherently rare in that corpus even for
// genuinely simple verbs (subtitles say "mow the lawn", not "he mows the
// lawn") — "mows"/"tidies"/"glues" all rank outside the top 50k despite being
// perfectly plain words. So VERB is hand-authored from everyday-action
// categories (cooking, cleaning, crafting, gardening, movement, care) instead
// of frequency-gated; see the VERB_POOL comment below.
//
// 24 Jul 2026 pass: cap every list at <=2 syllables so the sentence reads
// faster and "rolls off the tongue" — a checked heuristic (vowel-group count,
// same idea used by phonKey below) applied as a mechanical filter alongside
// concreteness/valence, same layering as everything else here. A strict
// 1-syllable-only list isn't feasible: the full concreteness-filtered pools
// only hold ~850 one-syllable nouns and ~180 one-syllable adjectives, which
// caps capacity around 2^33 — short of the UK grid's 2^36.45 even before any
// safety/phonetic cuts. Two syllables has ample supply (~2800 nouns, ~900
// adjectives in the raw pools) and still reads noticeably shorter.

import { readFileSync, writeFileSync } from 'node:fs';
const HERE = new URL('.', import.meta.url).pathname;
const DATA = process.env.WORDLIST_DATA ||
  '/private/tmp/claude-501/-Users-stuarthaigh-code-fun-whereareyou/af76cbff-3086-4ccf-8086-eabf154ccdc3/scratchpad/wordlist';

// ---------------------------------------------------------------------------
// Mechanical filters
// ---------------------------------------------------------------------------
const val = new Map();
for (const line of readFileSync(`${DATA}/warriner.csv`, 'utf8').split('\n').slice(1)) {
  const c = line.split(',');
  if (c.length > 3) val.set(c[1], parseFloat(c[2]));
}
const badwords = new Set(
  readFileSync(`${DATA}/badwords.txt`, 'utf8').split('\n').map(w => w.trim()).filter(w => /^[a-z]+$/.test(w))
);
// Everyday spoken-English frequency (hermitdave/FrequencyWords, OpenSubtitles
// 2018 en_50k) — used to window adjectives to genuinely common words. Word
// forms not present rank as Infinity (treated as rare).
const freqRank = new Map();
readFileSync(`${DATA}/en_50k.txt`, 'utf8').split('\n').filter(Boolean).forEach((line, i) => {
  const w = line.split(' ')[0];
  if (!freqRank.has(w)) freqRank.set(w, i + 1);
});
const commonRank = (w) => freqRank.has(w) ? freqRank.get(w) : Infinity;

const setOf = (s) => new Set(s.trim().split(/\s+/));

// US spellings that differ in UK English, plus US-only vocabulary.
const US_VARIANT = setOf(`
color colors colorful colorless favor flavor flavorful harbor armor armored honor humor labor neighbor rumor savor
savory vapor vigor odor odorless tumor parlor splendor valor endeavor behavior favorite favorable center theater
fiber liter caliber luster saber somber specter meager aluminum gray grayish mold molt plow ax adz donut doughnut
tire curb draft jewelry jeweled marvelous traveler woolen skillful pajamas pajama mustache mustached whiskey catalog
dialog program disk airplane sidewalk faucet diaper stroller pacifier zucchini eggplant cilantro rutabaga popsicle
flashlight sneaker thumbtack mailman mailbox mailbag restroom drugstore crosswalk streetcar gasoline vacation soccer
candy cookie closet drapes elevator apartment windshield freeway overpass turnpike dumpster trashcan realtor
railroad dime nickel oatmeal lasagna yogurt omelet armory checkbook paycheck meatloaf license cozy checkered
counselor jeweler plaid savory skeptical gotten
`);

// Could be heard as part of the actual emergency conversation.
const EMERGENCY = setOf(`
fire police ambulance doctor nurse hospital medic paramedic rescue rescuer accident emergency danger victim corpse
blood wound wounded bruise scar burn crash smoke flood gun handgun knife rifle pistol bullet buckshot bomb weapon
poison drug injury grave coffin morgue hearse funeral skull skeleton stretcher siren alarm help climber hiker
lifeguard lifeboat lifesaver flare beacon foghorn landmine warplane bazooka crossbow bayonet cannon canon dynamite
gunpowder tomahawk javelin trident sidearm snakebite amputee melanoma cancerous pacemaker mammogram sonogram
vasectomy embryo placenta hymen ovary ovum larvae larva trachea femur cranium retina cornea ventricle tonsil molar
denture eardrum bicep tendon hamstring kneecap tailbone hipbone thighbone jawbone cheekbone anklebone ribcage
follicle cuticle septum urethra stranded swelling blasted flaming fiery volcanic graphic shocking agitated
unharmed sheltered hardened startling behead beheaded cowpox lockjaw backache sickroom hogtie barbwire dogfight
`);

// People, family, and body — with free adjective pairing these can narrate harm.
const PEOPLE_BODY = setOf(`
man men woman women guy girl boy baby kid child person people father mother dad mom mommy daddy mama papa brother
sister son daughter husband wife uncle aunt auntie cousin grandma grandpa granddad grandson granny nanny godfather
godparent nephew niece lady gentleman stranger friend buddy fella dude teen teenager toddler infant twin triplet
sextuplet quintet adult elder folk sibling firstborn offspring stepchild newborn matron matriarch midwife maiden
head face eye ear nose mouth lip tooth tongue chin cheek jaw neck throat shoulder arm elbow wrist hand finger thumb
chest rib waist hip leg knee shin ankle foot toe heel skin scalp hair beard brow spine belly tummy stomach gut
heart lung liver kidney brain muscle bone flesh fist palm lap butt bottom thigh groin bosom breast nipple armpit
navel forearm torso eyeball eyelash eyelid earlobe eyebrow knuckle forehead abdomen bladder womb sperm vein jugular
vertebra vertebrae diaphragm pore nape freckle dimple wrinkle buttock foreskin scrotum teat udder hump goatee
sideburn ponytail pigtail hairdo afro perm braid mane whisker backbone backside pinkie lobe flank gizzard
pregnant naked female male elderly teenage feminine gay girly married mating undressed erect vaginal pubic
pulmonary digestive unborn facial dental oral immune clinical caged tanning colored coloured albino dwarf
midget cripple invalid orphan widow widower amputee gimpy legless purebred labia midriff clubfoot bucktooth
baldhead baldness
`);

// Could read as a literal description of where the caller is; terrain and
// wayfinding vocabulary is what rescue callers actually say.
const WAYFINDING = setOf(`
road street lane avenue highway motorway junction crossing crossroad roundabout exit entrance north south east
west northern southern eastern western eastbound left right mile yard metre kilometre kilometer corner block
address postcode signpost milepost hill mountain river lake beach cliff valley coast bay creek pond ridge summit
peak peninsula lagoon cove ravine bayou brook stream waterfall cave cavern canyon glacier crevice sea ocean tide
riptide reef iceberg island shoreline coastline seashore seafront riverbank riverbed hillside hilltop treetop
trail path footpath pathway walkway driveway doorway gateway archway stairway staircase stairwell stair doorstep
dune moor marsh swamp bog tundra plateau strait geyser volcano crater sinkhole landslide mudslide rockslide
sandbar sandbank incline slope ledge dock pier station airport wharf quay
`);

// Charged, embarrassing, or giggle-inducing on a 999 call.
const CHARGED = setOf(`
church chapel mosque temple priest bishop pope nun bible koran jesus christ god angel devil hell heaven sin prayer
rosary altar shrine synagogue monastery convent cathedral steeple pagan baptismal crematory mummified
beer lager wine vodka whisky brandy rum gin booze boozy pub tavern saloon cigarette cigar tobacco casino champagne
scotch bourbon tequila martini cocktail ale liquor keg brew cider cognac margarita sangria moonshine liqueur mead
malt winery brewery distilled tipsy sober
kiss lover romance bride groom wedding honeymoon darling sweetheart honey dear seductive flirty kissable adoring
bra panties knickers underwear thong corset garter lingerie negligee brassiere petticoat miniskirt nappy toilet
loo lavatory urinal bidet enema laxative commode bedpan erection erect erectile organ willy fanny bum crotch loin
rump pecker booty stud virginal orgasmic mammary pubic pelvic vaginal cervical prenatal neonatal expectant
pregnancy birth birthing maternal unwed conjugal bisexual nudist stripper brothel geisha lesbian midget gypsy
redhead redheaded brunette blonde housewife hooker cleavage hickey pantyhose loincloth peepshow pinup showgirl
senorita cockfight foxhunt bullfight torturer looter henchman skinhead guerrilla commando shitfaced
religious catholic roman domestic kosher seductive darned thieving
`);

const EXCLUDE = new Set([...badwords, ...US_VARIANT, ...EMERGENCY, ...PEOPLE_BODY, ...WAYFINDING, ...CHARGED]);

// ---------------------------------------------------------------------------
// Candidate pools (frequency-ordered)
// ---------------------------------------------------------------------------
// Vowel-group syllable estimator — not linguistically exact (silent letters,
// diphthongs) but good enough as a mechanical cap, same spirit as phonKey's
// vowel-run marking further down.
const MAX_SYLLABLES = 2;
function syllables(word) {
  let w = word.toLowerCase();
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
  w = w.replace(/^y/, '');
  const groups = w.match(/[aeiouy]{1,2}/g);
  return groups ? Math.max(1, groups.length) : 1;
}

const rows = readFileSync(`${DATA}/conc.tsv`, 'utf8').split('\n').slice(1).map(l => l.split('\t'));
function pool(pos, concMin, { noPluralS = false } = {}) {
  return rows
    .filter(r =>
      r[8] === pos && +r[1] === 0 && +r[2] >= concMin && +r[6] >= 0.95 &&
      /^[a-z]+$/.test(r[0]) && r[0].length >= 3 && r[0].length <= 9 &&
      (!noPluralS || !r[0].endsWith('s') || r[0].endsWith('ss')) &&
      (!val.has(r[0]) || val.get(r[0]) >= 4.5) &&
      syllables(r[0]) <= MAX_SYLLABLES &&
      !EXCLUDE.has(r[0]))
    .sort((a, b) => +b[7] - +a[7])
    .map(r => r[0]);
}

// ---------------------------------------------------------------------------
// NOUNS — drop list (reviewed over the top ~2400 of the pool)
// ---------------------------------------------------------------------------
// Roles kept deliberately (storybook-friendly): king queen prince princess
// duke duchess emperor jester captain sailor teacher dancer singer clown chef
// waiter butler farmer painter poet wizard magician shepherd gardener tailor
// barber astronaut pianist drummer librarian plumber postman scientist.
const NOUN_DROP = setOf(`
family couple president officer cop army navy boyfriend professor crew soldier commander mayor secretary governor
staff committee witness client player manager director assistant model actor maid citizen parent clerk scout
fighter chamber deputy chairman surgeon operator actress waitress employee announcer worker executive bachelor
bartender counselor reporter reverend rabbi preacher pastor cardinal chaplain monk marshal trooper platoon
regiment bunker outpost lawman patrolman marksman turret citadel fortress insignia gladiator matador musketeer
lancer warrior samurai ninja sword warhorse foxhole warthog czar pharaoh spy detective guard warden tank target
trigger badge vault decoy disguise petition ballot visa deposit payment currency dollar buck cent scent case
scene report radar mail victim hostage
mummy midget pecker sod stud crush massage bikini swimwear sleepwear nightwear menswear beachwear hosiery
pregnancy morphine valium insulin aspirin sedative vaccine medicine capsule dosage ointment deodorant mouthwash
antacid ibuprofen melatonin stimulant peroxide iodine laxative pill syringe plasma appendix
weed pot coke soda liquor moonshiner sperm
storm thunder lightning rain snow wind ice frost hail whirlwind windstorm rainstorm hailstorm snowfall rainfall
snowdrift blizzard raindrop rainwater whiteout meteor meteorite asteroid magma ember cinder soot brushfire
bonfire campfire firework firehouse fireplace firewood gaslight blowtorch furnace
hole pit shaft manhole tollgate tollbooth tollhouse underpass monorail runway speedway raceway fairway racetrack
airbase airline airliner airway airfare seaplane seaport shipyard dockyard boatyard stockyard junkyard
whole night sale sail mare mayor stake brake mousse pail yoke inn knot fir mussel pea thyme maize kernel brooch
bouquet croissant guacamole enchilada jalapeno parmesan ricotta burrito tamale pastrami bratwurst schilling peso
xylophone ukulele bagpipe bagpiper hymn tee flour suite oar ore fowl hare cereal sundae dough
subway diner motel dorm cafeteria takeout condo penthouse tux tuxedo sedan limo auto pickup jeep mustang bronco
rodeo softball ballpark blackjack poker lottery frisbee scrabble teepee tepee igloo sombrero poncho moccasin
tomcat bobcat opossum woodchuck groundhog chipmunk longhorn maverick gopher bison
booth deli mall outlet drivein
scarf turf gulf kin gap hem rye ale spa gel ore vat cot bun tab ref quad hump vent chow memo fax beep beeper
pager banner ledger liner loner lounger boater rower snorer kneeler chanter greeter sorter splitter drifter
crawler trekker slicer sifter riser blower mixer washer dryer duster grater peeler juicer broiler fryer copier
shredder scrubber sprayer strainer squeezer separator compactor compacter laminator fumigator sanitizer vaporizer
diffuser condenser adaptor charger recharger amplifier magnifier connector divider insulator fastener measurer
pedometer barometer thermostat carburetor sharpener
videotape cassette telegram telegraph microfilm audiotape filmstrip camcorder walkman pantsuit jumpsuit spandex
leotard tracksuit pantyhose bodysuit
lesbian brothel showgirl harem stripper
maggot phlegm mucus gristle welt eczema wart hangnail blackhead pockmark bedsore ringworm heartworm bloodworm
earwax dander stubble bristle froth spore fungus fungi algae kelp silt sludge sediment pulp glob spillage
dishwater bathwater seawater sewage
lynx boar stag hog sow ewe mule ox
scaffold gallows noose shackle scythe cleaver spear dagger whip bullwhip pickaxe jackknife penknife switchblade
machete crowbar
graveyard cemetery tomb tombstone casket urn ash
crotch rump loin giblet gizzard tripe lard suet gristle marrow
pit pip husk rind
chick hen? cockerel
booth kiosk stall
draft breeze gust gale
mist fog haze dew smog
peasant villager tribesman townsman herdsman woodsman boatman stableman footman horseman crewman workman
bellman bellboy bellhop busboy pageboy newsboy paperboy choirboy schoolboy tomboy cowgirl cowboy caveman
spaceman stuntman strongman muscleman anchorman taxman flagman milkman milkmaid washwoman newswoman mailwoman
saleslady salesgirl housemaid barmaid barman barkeeper innkeeper zookeeper beekeeper goalie cabbie trucker
biker jogger golfer surfer skier boxer fencer archer bowler curler sprinter lifter swimmer skater kayaker
snorkeler rafter gymnast acrobat wrestler referee umpire coach educator tutor recruiter applicant
nominee inductee retiree licensee taxpayer voter juror jurist lawmaker senator diplomat spokesman moderator athlete
panelist columnist novelist biologist geologist zoologist botanist physicist chemist historian analyst
hygienist dietician dietitian urologist embalmer mortician
caller talker watcher searcher shopper renter lodger settler migrant nomad pilgrim refugee islander landowner
homeowner homemaker caregiver caretaker repairman repairer locksmith goldsmith tinsmith blacksmith welder
driller riveter plasterer paver roofer logger miner rancher builder craftsman tradesman shipmate teammate
bunkmate coworker classmate roommate housemate bedmate neighbor
buyer seller vendor dealer scalper pawnshop invoice ledger receipt refund
wig toupee
crib playpen stroller
leech slug maggot tick flea louse roach cockroach termite bedbug earwig gnat wasp hornet
viper cobra python rattler serpent
fang talon claw? tusk?
skunk vulture buzzard hyena jackal
mole rat bat crow raven?
dungeon crypt cellar? attic?
noose gallows
pistol holster
sheriff bandit outlaw burglar robber thief crook killer sniper
carjacker jaywalker litterbug loiterer slanderer protester protestor brawler flasher
wart hive rash
crutch cast sling splint gurney wheelchair walker
morphine pill
ashtray lighter matchbook
pawn hock
dud scam con
gimmick hoax
strobe laser? taser
handcuff
straitjacket
padlock? deadbolt?
sewer drain gutter drainpipe
dump landfill
rust grime scum crud gunk
mothball
flypaper mousetrap flytrap roach
plunger
hamper? bin? dustbin?
squat crouch smirk snort gasp hiccup purr wink nudge grin smiley
gallop punt putt sprint dribble kickoff
joust uppercut
handclap handstand cartwheel curtsy yodel
hoedown polka
seance ouija
voodoo hex
tarot
palm? psychic
genie
zombie ghost ghoul goblin? vampire werewolf demon
witch warlock
fairy pixie? imp?
elf? gnome? troll ogre
crypt
skeleton?
spider web cobweb?
bat?
graveyard
pumpkin?
cauldron?
broom?
tress
gothic?
children teeth mice fuzz taffy veal hippie bar board taste spot herb token gallon pal cadet foreman topside
roadhouse checkout bleach condom parade beaker sheet cola caddy caddie cattle depot
body pulse breath heartbeat exhale mouthful birthmark abrasion compress gauze physician fireman seaman democrat
bodyguard cameraman janitor chauffeur attendant veteran tenant doorman watchman hostess heroine starlet mutant
bystander paparazzi advisor investor minstrel emcee typist laborer whaler bookmaker sportsman motorist lasso
boxcar shortstop infield ballgame playbook cornbread chowder licorice eggnog hotdog beefsteak entree appetizer
teriyaki linguini nacho fiesta cabana bologna pussycat slingshot gauntlet snare hobbit attire garment apparel
footwear necktie waistline trouser bathrobe icebox checker billiard sax quart mayflower sundown critter veggie
cockpit labyrinth gauge moustache yearbook mink ivory pageant lance embassy dwarf hunting wrestling skiing
mining steering shelter landmark roadside taillight headlight dashboard seatbelt airbag bumper fender axle
tailpipe throttle terrain mainland landscape skyline pipeline refinery hydrant welding buoy steamboat riverboat
ferryboat outboard homestead homeroom stateroom bunkhouse lithium sulfur potassium magnesium phosphate silicon
calcium titanium zinc cobalt graphite polymer alloy ginseng caffeine moisture organism ecosystem pesticide
cleanser lubricant lube adhesive membrane spawn clergy yeast chamomile chief press exterior diameter median
mannequin packer slot
lacquer directory enclosure seating lighting housing fragment article manicure pedicure chaperone tribe spur
rail oat canal watchdog flight doghouse
swordplay hood grinder sterling copy record grid land coating presenter collector binder
bushel conch vestibule kerchief corsage buckwheat pennant millstone glade palette duffel talisman motorcar
mariner blowfish unbutton stitching cluster cartridge asterisk sculptor karaoke itinerary dormitory oregano
barracuda orangutan accessory machinery academy poultry dice desert
scale juice spice drizzle wire valet clover dipper worm ace blush
dessert fizz lacrosse curve pattern vehicle video pile page post cuff troop flake sandbox backboard rocker
reservoir pool drape lettering enamel container showroom dugout sweeper money food essay carpeting salve
blindfold busload printing capital pupil clipping coolant printout flap backroom bulletin
`);
// Fourth block (read-aloud audit): hard-to-pronounce or spelling-trap words
// (asterisk, itinerary, palette≈pallet≈palate, orangutan/orangutang,
// desert≈dessert), plural leaks (dice, poultry), a POS-tag error (unbutton is
// a verb), and the noun side of cross-slot sound-alike/derived pairs where the
// adjective is the better word (juicy>juice, spicy>spice, drizzly>drizzle).
// Third block: weak words surfaced by the sample-sentence eyeball test.
// Second block: QA-pass catches — vital-signs words (body, pulse, breath),
// first-aid kit (gauze, compress), car-crash vocabulary (airbag, seatbelt),
// US strays, spelling traps, and clash-preference fixes (cattle/depot out so
// kettle/teapot survive).
// That last block settles phonetic clashes in favour of the better word
// (toffee over taffy, bear over bar, bird over board, toast over taste,
// spade over spot, harp over herb, toucan over token, galleon over gallon)
// and catches plurals/US words the pool filters missed.

// The set above intentionally over-lists; anything not present in the pool is
// ignored. Words with a trailing "?" were judgement calls — the "?" makes them
// NO-OPS (kept), documented here so the next reviewer sees they were weighed.
// Rationale for the kept ones: halloween-lite words (gnome, pumpkin, cauldron,
// broom, cobweb, elf, pixie, imp) read storybook, not morbid; cellar/attic/bin/
// dustbin/hamper/padlock/deadbolt/claw/tusk/raven/hen are tame household or
// nature words.

// UK flavour + storybook additions, and rescues from deep in the pool that the
// frequency window would otherwise cut. All: concrete, spellable, UK-natural.
const NOUN_ADD = `
fox robin sparrow magpie wren puffin heron swan newt unicorn pirate baker juggler piper
bluebell snowdrop primrose tulip daisy bramble thistle ivy moss
crumpet trifle tartan tweed allotment shed bunting paddock eggcup drum
hedgehog daffodil dandelion teacup sunflower acorn pinecone bumblebee honeybee saucepan teaspoon crayon easel
thimble figurine gnome teapot scone porridge toffee marmalade custard pudding dumpling flapjack sherbet
waistcoat kilt cardigan jumper corduroy dustbin letterbox newsagent skittle teashop sweetshop gazebo trowel
spade hedge chimney lantern coaster napkin cutlery kettle
tortoise gecko koala toucan cockatoo flamingo ostrich pheasant blackbird songbird seagull albatross pelican
emu gerbil porcupine mongoose anteater orangutan chameleon iguana manatee puma gazelle antelope mammoth
tadpole minnow foal fawn seahorse starfish
galleon tugboat steamship houseboat kayak canoe paddle
scarecrow haystack tractor windmill lamppost birdbath armchair bookshelf bookmark
banjo violin cello trombone trumpet tuba harp flute clarinet saxophone harmonica accordion mandolin
moat treasure dragon mermaid parrot wand telescope compass? globe peacock circus rucksack
badger beetle snail toad mole weasel otter owl duckling goose lamb pony donkey squirrel? robin?
cottage barn windmill? meadow orchard pumpkin turnip carrot potato onion cabbage lettuce? radish
biscuit muffin waffle pancake sausage bacon jelly custard? syrup honey jam butter cream sugar
`.trim().split(/\s+/).filter(w => !w.endsWith('?'));

// 24 Jul 2026: "common enough" and "easy to spell from hearing it" are
// different axes — a word can be short, safe and reasonably common and still
// be a word people routinely misspell. Found by hand-reviewing every word
// with an irregular double letter (vacuum's "uu", not "well"'s regular
// short-vowel doubling) or a loanword spelling pattern (croquette, baguette,
// ballet, cello — French/Italian endings that don't follow English
// sound-to-letter rules). Kept the common irregular ones anyway where they're
// too basic to actually trip anyone up (laugh, crumb, wreath, yolk).
const NOUN_SPELL_DROP = setOf(`
ballet carriage vacuum squirrel buffet lettuce latte cello raccoon llama sapphire aardvark
minnow baguette gallstone shellac shallot croquette gnome vessel sonnet stirrup scallion henna galley
`);

// 24 Jul 2026, second round: Stu spotted more of the same problem by eye
// (lozenge, perfumed, engrossed, varnishes, crabgrass) — words that are
// technically "regular" spelling but just aren't common/simple vocabulary,
// which the frequency window's internal SUBTLEX sort let through. Checked
// each of the ~500 lowest-ranked (by en_50k, real everyday-speech frequency)
// nouns in the list by hand and dropped the genuinely niche/technical/jargon
// ones — automotive/construction/photography/tech jargon (gearbox, drywall,
// browser, darkroom, webcam), medical/injury-adjacent (backache, lockjaw,
// clubfoot, sickroom, cowpox — also a real safety-relevant miss, and "labia"
// and "behead" which should never have been in a noun list at all), niche
// materials/trades (calfskin, whetstone, saltine), and abstract/formal words
// (firmness, roundness, scion, morsel). Kept plenty of lower-ranked words that
// are still genuinely simple UK/storybook vocabulary (kettle-style) even
// though rarer in conversational-subtitle terms.
const NOUN_SPELL_DROP2 = setOf(`
varnish behead truckload hangout gearbox scribe payphone pigment template fixture drywall
handbrake browser shoeshine kiln crawfish labia postmark burlap inbox hatchback rafting fructose
blinker grout newscast pixel plumage baldness sunroof midfield watershed dachshund poolside choker
dogfight fluoride firmness redness lockbox angler lockjaw backache cacti webbing airbrush
placard scion hairpiece barstool groomsman foamy inkwell pushup sealant yearling gearshift sandlot etching
pinstripe calfskin hemline saltine sealer flapper whetstone clubfoot midriff sickroom flagstone
guardsman newsprint inseam lozenge airstream hubcap bucktooth cowhide curbside crabgrass groomer
cowpox trainload shipper bobtail deadbolt tinting webpage lambskin blowpipe landmass redcoat longneck
tiling coalmine goatskin brickyard sharkskin flashbulb cursor handclasp shipload hogtie headwear barbwire
redbird railcar baldhead floodgate glasswork dialer roundness pegboard sparkplug pressroom cowskin
hoopskirt seafloor roofline woodblock footgear snowcap blackfish paintwork swampland seacoast cartload
sulfite primate carpool piston farmland sawmill darkroom foothold postage newsroom pellet sheath
webcam headgear flooring wingspan pushcart barbell backfield blacktop flatware strongbox carload coatroom
portside longboat upwind yardstick prong
`);

// ---------------------------------------------------------------------------
// ADJECTIVES — frequency-windowed (like NOUN), not a hand-picked keep list.
//
// 23 Jul 2026: the old ADJ_KEEP was built by "reviewing the pool" with no
// commonness signal, so it drifted toward literary/period words (medieval,
// glamorous, orderly, cosmic, celestial, stately, jaunty, dapper, plucky) —
// exactly the "not common vernacular" complaint. Fix: window the mechanical
// pool to the ADJ_RANK_CAP most common words by everyday speech frequency
// (commonRank, from en_50k.txt), same pattern as NOUN_WINDOW. Frequency alone
// still lets some register-wrong words through (a period/formal word can have
// an unremarkable corpus rank), so ADJ_DROP below removes those by hand.
// ---------------------------------------------------------------------------
const ADJ_RANK_CAP = 46000;

// Hand-drops from the frequency-windowed pool, grouped by why:
const ADJ_DROP = setOf(`
bigger biggest older younger greater smaller taller warmer hotter smoother shorter thinner colder higher lower
highest nearest clearer eldest furthest sharper fatter greener sicker
married pregnant medical naked female male wounded religious catholic roman domestic swelling stranded blasted
flaming fiery volcanic graphic shocking agitated colored childish facial elderly feminine mating undressed girly
teenage native tribal civilian martial imperial naval allied manned dental immune clinical oral pulmonary
digestive vaginal pubic erect caged tanning secluded startling darned seductive unharmed sheltered hardened
prone unborn kosher thieving paramedic military ballistic masked hooded sedate sanitary sterile saline molten
mass joint bony afflicted withered jobless minor false crazy physical intense chilling frisky
afghan apache oriental ethnic colonial secular
sole stable smashing swell moped canine jerky humanoid tweeting eyed
medieval glamorous orderly cosmic literary celestial gothic luxurious intricate elaborate fetching robust lavish
dashing tenacious mystic earthly
sensory ample perpetual potent pleasing dormant lucid tangible abundant unmarked adjacent communal lateral
linear acoustic optical hydraulic iconic prolonged observant tabloid preschool upward dual unanimous auxiliary
editorial founding certified eligible licensed frontal cosmetic visionary advancing tutoring vending surplus
residual composite binary monetary generic molecular cellular automated rigorous verbal lawful civic clerical
retail haywire trucking puzzling scenic uncharted
joint mobile minor intense stable remote native marine permanent remaining incoming rapid urban rural indoor
outdoor sheer weekly monthly yearly parallel secondary regional operative athletic steep inclined sporting
airborne vertical euro mid onstage offshore afloat coastal maritime prime roast distant
bodily bridal chemical complete cubic culinary dependent fashioned fertile flipping formal frivolous glaring
handsome human inner local longtime muscular nagging official parental petite postal psychic recent rhythmic
rugged saucy skinny sled slender solitary sparse stinking tanned tender triple tropical uncommon utter vacant
wholesale youthful genetic
ablaze boyish cranial dorsal shirtless childlike blooded bloodless congested dwindling frenzied gated grappling
handheld inflamed metric mouthy multi outer patented postwar reactive searing serrated skimpy slacker stillborn
strapping swampy tartar thrusting unmanned unscathed untreated unturned unwashed uprooted visual vocal wooded
godlike grandiose nosey dumpy dorky loopy muddled ingest channeled discrete factual grating boney caped forked
broadband soybean tropic wordy
balder cymbal duplex farmhand flatbed ornate porous scabby scalded sicken sloping teary unsigned viscous
waterbed witchy
`);

// A handful of good, plain, safe words sitting just beyond ADJ_RANK_CAP — the
// band right past the cap is dominated by medical/technical/nationality
// jargon (cervical, extremist, prenatal, pandemic, dorsal, shitfaced), so
// rather than raise the cap wholesale this hand-picks the genuine keepers.
const ADJ_ADD = `
nimble comical budding lilac sporty brisk woolly tangerine glazed stony husky flowery gooey indigo chewy breezy
squishy feline assorted stainless homely sleek supple durable silvery flowering moonlit cushy gilded sizable
evergreen bushy fizzy frosted succulent minty wrinkly checkered bleached layered zippy toasty ruffled bracing
spiced angular reddish beefy whopping roomy chalky balmy diagonal sparse stocky rippling seamless curvy lanky
mauve showy leafy meaty elongated ajar glossy weathered limber teensy amiable potted geeky silken
`.trim().split(/\s+/);

// 24 Jul 2026: spelling-difficulty pass — see the NOUN_SPELL_DROP comment for
// the rationale (irregular doubling, loanword endings). "rougher" is also a
// comparative that slipped past the earlier comparative-form drop. "perfumed"
// and "engrossed" are Stu's own examples — technically regular spelling, but
// not common/simple words either.
const ADJ_SPELL_DROP = setOf(`rougher perfumed engrossed looser firmer drier inverted`);

// Rows above (in ADJ_DROP), in order: comparative/superlative (grammatically odd standalone
// before a noun, and redundant with the base form already in the list);
// safety/body/identity/political/religious-adjacent — even where the word
// alone is innocuous, this product must never risk a random combination
// reading like a description of a person or their state; homophone/dual
// -meaning (sole≈soul, stable is also a noun, smashing/swell evoke violence
// or read as dated slang); and the direct complaint — literary, period,
// subculture, or textbook-formal register that reads like a novel or a form,
// not something anyone says over the phone.

// ---------------------------------------------------------------------------
// VERBS — hand-authored from everyday-action categories, NOT frequency-gated.
//
// 23 Jul 2026: the old verb list was an alphabetically-curated seed with zero
// commonness signal (source of "garnishes", "chisels", "engraves") — the
// worst offender of the three lists. Frequency data turns out to be the WRONG
// tool to fix it: the sentence frame needs 3rd-person-singular ("chair
// weaves..."), and that inflection is inherently rare in everyday speech even
// for dead-simple verbs — subtitle corpora say "mow the lawn", not "he mows
// the lawn", so "mows"/"tidies"/"glues" all rank outside the top 50k common
// words despite being perfectly plain. So this list is built the other way:
// only genuinely everyday action categories (cooking, cleaning, crafting,
// gardening, movement, care), each word chosen because it's something anyone
// says aloud, not because a corpus ranked it.
// ---------------------------------------------------------------------------
const VERB_POOL = `
bakes boils roasts fries peels slices dices chops grates mixes stirs whisks blends butters sweetens seasons
simmers steams toasts grills scrambles mashes spreads pours fills empties scoops sprinkles glazes drizzles
kneads rolls stacks packs wraps unwraps squeezes juices ladles stuffs
washes wipes mops sweeps dusts scrubs polishes shines cleans tidies sorts folds hangs irons rinses drains
vacuums
builds fixes repairs mends sews knits stitches patches glues tapes nails screws bolts hammers drills saws sands
varnishes paints draws sketches prints stamps doodles traces copies cuts snips trims carves weaves threads
ties knots pins clips buttons zips laces buckles sculpts moulds shapes piles files
digs plants waters rakes mows prunes weeds harvests picks plucks grows seeds
runs walks jumps hops skips climbs swims dives floats sails paddles rows drives rides flies glides spins bounces
slides skates trots gallops wobbles waddles scampers leaps hovers drifts rocks swings twirls marches strolls
wanders roams explores parks
feeds strokes pats hugs waves greets welcomes thanks cheers praises comforts helps guides leads follows teaches
shows tells reads sings hums whistles plays dances shares gives serves carries holds lifts lowers raises pushes
pulls drops catches throws grabs taps knocks rings turns opens closes warms cools heats chills freezes melts
cuddles soothes calms claps applauds brushes combs herds tames trains kicks passes scores wins races chases
sets covers uncovers arranges displays colours offers invites visits joins meets hosts watches listens smells
touches tastes finds loses keeps brings sends delivers collects gathers counts weighs measures checks tries
starts stops begins ends finishes waits rests sleeps wakes dreams hatches nests buzzes chirps barks purrs
locks unlocks answers calls learns studies practises writes adds milks grazes travels crawls tiptoes tickles
makes creates drums chimes glows gleams presses splashes drips flavours strums yawns stretches jogs surfs skis
bathes dresses pretends smiles grins giggles laughs nods bows points nibbles munches gobbles sips gulps licks
chews dabs pecks whittles hides seeks spots moos oinks quacks clucks hoots snores hiccups sneezes blinks winks
gazes peeks twists sways soars plaits squints frowns beams shrugs sniffs whispers cores halves quarters grinds
shovels ploughs nips pets yips darts ticks docks raps flaps hauls toots roots bobbles fidgets plods scoots
swishes crackles pops fizzes bubbles chirrups warbles whirs honks seeps trickles glints patters gurgles
rumbles clicks pings beeps peeps chomps slurps prances squeaks dazzles snorts pumps stumps
flutters roosts burrows signs labels tags ropes hooks releases frees lends stores swaps trades salts oils
greases quilts braids beads hems darns shuts juggles balances shears saddles canters chuckles sighs pouts
blushes snoozes naps dozes creases staples erases airs dries soaks sprays drags tugs nudges bends straightens
flips unrolls peers leans kneels crouches reaches settles perches wades totters types scribbles buys sells
preens pounces doubles buffs scours twinkles shimmers glimmers sparkles glistens flashes guesses wonders
imagines remembers forgets notices discovers whirls bobs dips flicks pokes prods jiggles wiggles shakes
scrapes smears dollops coats spools winds unwinds flops plops zooms creaks rustles sizzles wriggles shuffles dabbles fiddles tinkers clambers ambles potters
dawdles trudges paces skitters ripples wafts lingers nestles snuggles curls glances asks replies explains
describes agrees promises borrows returns sledges shells scampers hurries ambles saunters bustles fusses
potters pauses rests halts continues repeats practises rehearses dings clinks crunches flattens smooths levels
thaws crochets hands bleats neighs brays vaults admires trusts hopes wishes tosses layers decorates rubs grips
clasps strides blooms sprouts ripens relaxes invents arrives reverses steers minds eats drinks wears hoovers
fancies reckons natters bastes bowls putts dribbles volleys tightens loosens camps fishes shades tints crinkles
wrinkles rambles wags bags flows blows crumbles leaves treasures nuzzles moves talks walks visits packs
mixes bakes trims hums seals stacks folds pours melts warms crawls floats sinks bounds coils twists loops
hoes mills stews churns shrinks expands clears cooks stains waxes fastens bundles boxes
drenches smudges scratches etches squashes plumps fluffs vents froths purees shreds minces edges tilts treks
pinches strings clutches frolics capers rewinds swirls mingles unites merges splits descends refills
restores renews replaces remains stays earns spends records lists notes marks orders numbers plans forms
`.trim().split(/\s+/);

// 24 Jul 2026: spelling-difficulty pass on the verb pool too — vacuums (the
// double-u) and applauds (the "au", plus a bit formal) are exactly what Stu
// flagged; whittles/ploughs/chirrups/natters are genuine but less common
// words most people wouldn't reliably spell either.
const VERB_SPELL_DROP = setOf(`vacuums applauds whittles ploughs chirrups natters varnishes`);

// ---------------------------------------------------------------------------
// Homophone / near-homophone audit (across ALL lists — a dispatcher must never
// have two plausible spellings for one heard word). Each group: at most one
// member may survive, and it must be listed first (the natural transcription).
// ---------------------------------------------------------------------------
const HOMOPHONES = [
  ['night', 'knight'], ['bear', 'bare'], ['pear', 'pair'], ['flower', 'flour'], ['steel', 'steal'],
  ['steak', 'stake'], ['plane', 'plain'], ['board', 'bored'], ['bell', 'belle'], ['sun', 'son'],
  ['moose', 'mousse'], ['deer', 'dear'], ['dough', 'doe'], ['rose', 'rows'], ['pole', 'poll'],
  ['piece', 'peace'], ['whale', 'wail'], ['gate', 'gait'], ['air', 'heir'], ['meat', 'meet'],
  ['tea', 'tee'], ['sweet', 'suite'], ['fur', 'fir'], ['yolk', 'yoke'], ['maze', 'maize'],
  ['horse', 'hoarse'], ['border', 'boarder'], ['wax', 'whacks'], ['sage', 'sayge'],
  ['cash', 'cache'], ['boar', 'bore'], ['fowl', 'foul'], ['lynx', 'links'], ['moors', 'mores'],
  ['prunes', 'proons'], ['draws', 'drawers'],
];

// ---------------------------------------------------------------------------
// Assemble
// ---------------------------------------------------------------------------
const NOUN_WINDOW = 2800;
const nounPool = pool('Noun', 3.9, { noPluralS: true });
const adjPool = pool('Adjective', 2.3);

let NOUN = nounPool.slice(0, NOUN_WINDOW);
for (const w of NOUN_ADD) if (!NOUN.includes(w)) NOUN.push(w);
NOUN = NOUN.filter(w => !EXCLUDE.has(w) && !NOUN_DROP.has(w) && !NOUN_SPELL_DROP.has(w) && !NOUN_SPELL_DROP2.has(w) && syllables(w) <= MAX_SYLLABLES);

// Read-aloud audit culls: adjectives that sound too close to a kept noun
// (jolly≈jelly, cheery≈cherry, burly≈barley, furry≈ferry, dinky≈donkey), the
// adjective side of derived pairs where the noun is the better word
// (rose>rosy, bubble>bubbly, sponge>spongy, lace>lacy, pottery>buttery), and
// 4+ syllable or fancy adjectives that make sentences a mouthful.
const ADJ_CULL = setOf(`
rosy wavy bubbly spongy lacy dinky jolly buttery burly perky cheery furry automatic analogue acrylic
`);

let ADJ = adjPool
  .filter(w => commonRank(w) <= ADJ_RANK_CAP)
  .sort((a, b) => commonRank(a) - commonRank(b));
for (const w of ADJ_ADD) if (!ADJ.includes(w)) ADJ.push(w);
ADJ = ADJ.filter(w => !EXCLUDE.has(w) && !ADJ_CULL.has(w) && !ADJ_DROP.has(w) && !ADJ_SPELL_DROP.has(w) && syllables(w) <= MAX_SYLLABLES);

let VERB = [...new Set(VERB_POOL)];
VERB = VERB.filter(w => !EXCLUDE.has(w) && !VERB_SPELL_DROP.has(w) && syllables(w) <= MAX_SYLLABLES);

// Length + charset guard on everything (adds included)
const wellFormed = w => /^[a-z]+$/.test(w) && w.length >= 3 && w.length <= 9;
NOUN = NOUN.filter(wellFormed); ADJ = ADJ.filter(wellFormed); VERB = VERB.filter(wellFormed);

// Homophone audit: drop any later-listed member whose group leader is present.
const allWords = () => new Set([...NOUN, ...ADJ, ...VERB]);
for (const group of HOMOPHONES) {
  const present = group.filter(w => allWords().has(w));
  if (present.length > 1) {
    const keep = group.find(w => allWords().has(w));
    for (const w of present) if (w !== keep) {
      NOUN = NOUN.filter(x => x !== w); ADJ = ADJ.filter(x => x !== w); VERB = VERB.filter(x => x !== w);
      console.log(`homophone: dropped "${w}" (kept "${keep}")`);
    }
  }
}

// Cross-list dedupe: nouns win, then adjectives.
const nset = new Set(NOUN);
ADJ = ADJ.filter(w => !nset.has(w));
const aset = new Set(ADJ);
VERB = VERB.filter(w => !nset.has(w) && !aset.has(w));

// Phonetic-distinctness prune within each slot (first-listed wins = highest
// frequency wins). Two words clash only if BOTH (a) their phonetic skeletons
// match — consonant classes with digraphs resolved, vowel runs marked, so
// syllable shape counts — and (b) spelling edit distance ≤ 2. The old rule
// ignored vowels entirely and merged non-rhymes like "chair"/"car".
function phonKey(w) {
  let s = w.replace(/ck/g, 'k').replace(/ph/g, 'f').replace(/wh/g, 'w').replace(/qu/g, 'kw')
    .replace(/ch/g, '1').replace(/sh/g, '2').replace(/th/g, '3')
    .replace(/c([eiy])/g, 's$1');
  const cls = { b: 'P', p: 'P', c: 'K', k: 'K', g: 'K', q: 'K', d: 'T', t: 'T', v: 'F', f: 'F', s: 'S', z: 'S', m: 'N', n: 'N', 1: 'C', 2: 'H', 3: 'O' };
  let out = '', prevV = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === 'h' && i > 0) continue;              // mid-word h: silent-ish, doesn't break a vowel run
    if (ch === 'h') { out += 'H'; continue; }       // initial h is pronounced (heron ≠ iron)
    if ('aeiou'.includes(ch) || (ch === 'y' && i > 0)) { if (!prevV) out += 'V'; prevV = true; continue; }
    prevV = false;
    const c = cls[ch] || ch.toUpperCase();
    if (out[out.length - 1] !== c) out += c;        // collapse doubles (potted → P V T V T)
  }
  return out;
}
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
function prune(list, label) {
  const byKey = new Map(), out = [];
  for (const w of list) {
    const k = phonKey(w);
    const prior = byKey.get(k) || [];
    const clash = prior.find(p => lev(p, w) <= 2);
    if (clash) { console.log(`phon ${label}: dropped "${w}" (clashes with "${clash}")`); continue; }
    prior.push(w); byKey.set(k, prior); out.push(w);
  }
  return out;
}
NOUN = prune(NOUN, 'noun'); ADJ = prune(ADJ, 'adj'); VERB = prune(VERB, 'verb');

// Nouns: trim to the largest prime ≤ length (checksum modulus must be prime
// and nouns must be the largest list).
const isP = n => { for (let i = 2; i * i <= n; i++) if (n % i === 0) return false; return n > 1; };
let P = NOUN.length; while (!isP(P)) P--;
NOUN = NOUN.slice(0, P);
if (ADJ.length >= NOUN.length || VERB.length >= NOUN.length) throw new Error('nouns must be the largest list');

// Capacity check against the UK 3 m grid.
const A = ADJ.length, N = NOUN.length, V = VERB.length;
const capBits = 2 * Math.log2(A) + Math.log2(N) + Math.log2(V);
const LA0 = 49.8, LA1 = 61.0, LO0 = -8.7, LO1 = 1.9, TARGET = 3;
const LATC = Math.ceil((LA1 - LA0) * 111320 / TARGET);
const LONC = Math.ceil((LO1 - LO0) * 111320 * Math.cos(55 * Math.PI / 180) / TARGET);
const gridBits = Math.log2(LATC * LONC);
console.log(`\nlists: adj ${A}, nouns ${N} (prime ${isP(N)}), verbs ${V}`);
console.log(`capacity 2^${capBits.toFixed(2)} vs grid 2^${gridBits.toFixed(2)} ${Math.pow(2, capBits) >= LATC * LONC ? 'OK' : 'TOO SMALL'}`);
if (Math.pow(2, capBits) < LATC * LONC) throw new Error('capacity below UK 3m grid — add words or coarsen');

writeFileSync(`${HERE}/../nouns.json`, JSON.stringify(NOUN, null, 1));
writeFileSync(`${HERE}/../adjectives.json`, JSON.stringify(ADJ, null, 1));
writeFileSync(`${HERE}/../verbs.json`, JSON.stringify(VERB, null, 1));
console.log('wrote ../nouns.json ../adjectives.json ../verbs.json');
