import type { ArticleLanguage, ArticleRegion, ArticleTopic } from "./types.js";

// Entries are words or phrases. A trailing * matches inflected forms of the last word.
export const LANGUAGE_WORDS: Record<ArticleLanguage, string> = {
  en: "the and of in for from with has have was were will their said to after",
  pl: "i oraz że się jest są dla przez został została według który która do na po nie ze",
  ru: "и что это как для был были уже после по на из между заявил также который его они",
  uk: "і та що це як для був були вже після до на від між заявив також який його вони",
  de: "der die das den dem und mit für aus ist sind von wird wurde nach zum zur sich nicht",
  fr: "les des une aux dans avec pour sur est sont dont selon après cette été",
  es: "los las una del por para con desde tras según está han sido sobre entre",
  be: "і ды што гэта як для быў былі ўжо пасля да ад паміж заявіў які яго яны",
};

export const REGION_WORDS: Record<Exclude<ArticleRegion, "OTHER">, readonly string[]> = {
  PL: [
    "poland", "polish", "warsaw", "gdańsk", "gdansk", "rzeszów", "rzeszow", "bialystok", "polsk*", "polsce", "warszaw*",
    "białystok", "podlasi*", "podlask*", "suwalki", "suwałk*", "olsztyn*", "kraków", "krakow", "wrocław", "wojsko polskie", "tarcza wschód",
    "польша", "польши", "польше", "польшу", "польш*", "польськ*", "польск*", "польщ*", "варшав*", "polen", "polnisch*", "warschau",
  ],
  BALTIC: [
    "baltic*", "estonia*", "latvia*", "lithuania*", "tallinn*", "riga", "rīga", "vilnius*", "narva", "klaipėda", "gotland",
    "bałty*", "bałtyc*", "estoni*", "estońsk*", "łotw*", "łotewsk*", "litwa", "litwy", "litwę", "litwie", "litewsk*", "wiln*", "rydze", "ryga",
    "балти*", "прибалти*", "литв*", "литовск*", "литовськ*", "латви*", "латві*", "эстони*", "естоні*", "таллінн*", "вильнюс*", "вільнюс*",
    "baltikum", "baltisch*", "estland", "estnisch*", "lettland", "lettisch*", "litauen", "litauisch*", "ostsee",
  ],
  RU: [
    "russia*", "moscow", "kremlin*", "kaliningrad*", "kursk", "belgorod", "putin*", "russian armed forces",
    "rosj*", "rosyjsk*", "moskw*", "królewiec", "królewca", "królewcu", "obwód kaliningradzki",
    "росси*", "российск*", "росі*", "російськ*", "москв*", "кремл*", "калининград*", "калінінград*", "курськ*", "белгород*", "бєлгород*", "путін*", "путин*",
    "russland", "russisch*", "moskau", "königsberg",
  ],
  BY: [
    "belarus*", "minsk*", "lukashenko", "lukašenko", "hrodna", "grodno", "brest region",
    "białoru*", "białorusk*", "mińsk*", "łukaszenk*", "grodn*", "brześć",
    "белару*", "белору*", "білору*", "мінськ*", "минск*", "лукашенк*", "гродно", "гродна",
    "belarussisch*", "weißrussland", "weißrussisch*", "lukaschenko",
  ],
  UA: [
    "ukrain*", "kyiv*", "kiev", "kharkiv*", "odesa", "odessa", "lviv", "donbas*", "donets*", "luhans*", "zaporizh*",
    "kherson*", "mykolai*", "crimea*", "zelensky*", "afu", "armed forces of ukraine",
    "kijow*", "kijów", "charkow*", "charków", "lwów", "lwow*", "krym*", "chersoń*", "zaporos*", "zełensk*",
    "украин*", "україн*", "киев*", "київ*", "києв*", "харьков*", "харків*", "харков*", "одес*",
    "львов*", "львів*", "донбас*", "донецьк*", "донецк*", "луган*", "запор*", "херсон*", "крим*", "крым*", "зеленськ*", "зеленск*", "зсу", "всу",
    "ukrainisch*", "kiew", "selenskyj", "krim",
  ],
  EU: [
    "eu", "europe*", "brussels", "eastern flank", "germany", "german", "berlin", "france", "french", "paris", "britain", "british", "united kingdom",
    "london", "uk government", "finland", "finnish", "sweden", "swedish", "norway", "norwegian", "denmark", "danish", "romania", "romanian", "moldova",
    "netherlands", "dutch", "czech*", "slovak*", "spain", "spanish", "italy", "italian", "hungary", "hungarian", "greece", "greek", "balkans",
    "europ*", "unia europejska", "unii europejskiej", "wschodnia flanka", "wschodniej flanki", "bruksel*", "niemcy", "niemieck*",
    "francj*", "francusk*", "wielka brytania", "brytyjsk*", "szwecj*", "szwedzk*", "finlandi*", "fińsk*", "rumuni*", "mołdawi*", "czech*", "słowac*",
    "ес", "єс", "европ*", "європ*", "брюссел*", "брюссель", "берлін*", "герман*", "німеччин*", "німец*", "франц*",
    "великобритани*", "великобритані*", "финлянди*", "фінлянді*", "швеци*", "швеці*", "румуні*", "румыни*",
    "deutschland", "deutsch*", "frankreich", "französisch*", "großbritannien", "britisch*", "nato ostflanke", "schweden", "finnland", "rumänien",
  ],
};

export const TOPIC_WORDS: Record<Exclude<ArticleTopic, "other">, readonly string[]> = {
  military: [
    "military", "defence", "defense", "armed forces", "army", "troops", "air force", "navy", "nato", "war", "warfare",
    "missile*", "airstrike*", "air strike*", "drone*", "artillery", "fighter jet*", "air defence", "air defense", "frigate*", "warship*",
    "battalion*", "brigade*", "tank", "tanks", "mobilization", "counteroffensive", "battlefield", "defence ministry", "pentagon", "ground forces",
    "wojsk*", "wojna", "wojny", "wojnę", "wojnie", "armi*", "żołnier*", "dron*", "rakiet*", "brygad*", "batalion*", "pocisk*",
    "siły zbrojne", "sił zbrojnych", "obronność", "obronnoś*", "obrona powietrzna", "obrony powietrznej", "zbrojeni*", "czołg*", "myśliwc*",
    "dowództw*", "ćwiczenia wojskowe", "mon", "17 wielkopolska", "16 dywizja zmechanizowana", "dywizja zmechanizowana",
    "военн*", "військ*", "война", "войны", "войне", "войну", "війн*", "арми*", "армі*", "бригад*", "батальйон*", "батальон*",
    "дрон*", "беспилот*", "безпілот*", "ракет*", "артиллери*", "артилері*", "пво", "ппо", "всу", "зсу", "мобилизац*", "мобілізац*",
    "militär*", "bundeswehr", "streitkräft*", "streitkraft", "armee", "krieg", "kriegs*", "soldat*", "raket*", "drohne*", "flugabwehr", "kampfjet*", "verteidigungs*",
  ],
  security: [
    "security", "border guard*", "border crossing*", "border controls", "border patrol*", "border security", "airspace violation*",
    "sabotage", "cyberattack*", "cyber attack*", "cybersecurity", "espionage", "spying", "intelligence service*", "terroris*", "hybrid threat*", "disinformation",
    "smuggling", "sanctions", "shadow fleet", "coast guard", "undersea cable*", "critical infrastructure", "state of emergency",
    "bezpieczeńst*", "straż graniczna", "straży granicznej", "funkcjonariusze sg", "granicy z", "przejście graniczne", "sabotaż", "szpieg*", "cyberatak*",
    "dezinformac*", "terroryz*", "sankcj*", "flota cieni", "floty cieni", "służby specjalne", "przemyt*", "infrastruktura krytyczna",
    "безопасност*", "безпек*", "погранич*", "прикордон*", "границ*", "кордон*", "диверси*", "диверсі*", "кибератак*", "кібератак*",
    "шпион*", "шпигун*", "разведк*", "розвідк*", "теракт*", "террор*", "терор*", "санкц*", "дезінформац*", "дезинформац*",
    "sicherheit*", "grenzschutz", "grenzkontroll*", "spionage", "cyberangriff*", "cybersicherheit", "sanktion*", "sabotage", "schattenflotte",
  ],
  politics: [
    "government", "parliament*", "election*", "president*", "prime minister", "foreign minister", "diplomac*", "peace talks", "ceasefire",
    "coalition", "summit", "legislation", "referendum", "opposition", "lawmakers", "political party", "peace plan", "negotiation*", "foreign policy",
    "rząd*", "sejm*", "senat*", "wybor*", "wybór", "prezydent*", "premier*", "minister*", "dyplomac*", "parlament*", "ustaw*", "koalicj*", "opozycj*", "rozejm*", "negocjac*",
    "правительств*", "уряд*", "парламент*", "вибор*", "выбор*", "президент*", "дипломат*", "переговор*", "перемир*", "оппозици*", "опозиці*", "коаліц*", "коалиц*",
    "regierung*", "bundestag", "parlament*", "wahl", "wahlen", "präsident*", "kanzler*", "diplomat*", "koalition*", "gesetzentwurf*", "waffenstillstand",
  ],
};
