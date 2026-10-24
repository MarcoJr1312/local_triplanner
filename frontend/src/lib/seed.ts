import type { Activity, Destination, Member, Trip, TripItem } from './types';
import { inviteCodeFor, nowIso, uid } from './format';

export const SEED_USERS: Record<string, { userId: string; email: string; displayName: string; color: string }> = {
  'user-marco': { userId: 'user-marco', email: 'marco@demo.com', displayName: 'Marco Rossi', color: '#0d9488' },
  'user-sofia': { userId: 'user-sofia', email: 'sofia@demo.com', displayName: 'Sofía Gómez', color: '#f59e0b' },
  'user-diego': { userId: 'user-diego', email: 'diego@demo.com', displayName: 'Diego Herrera', color: '#6366f1' },
  'user-valeria': { userId: 'user-valeria', email: 'valeria@demo.com', displayName: 'Valeria Rojas', color: '#ec4899' },
  'user-mateo': { userId: 'user-mateo', email: 'mateo@demo.com', displayName: 'Mateo Suárez', color: '#10b981' },
};

export const CURRENT_USER_ID = 'user-marco';

export const seedDestinations: Destination[] = [
  {
    slug: 'toronto',
    name: 'Toronto',
    country: 'Canada',
    description:
      "La ciudad más grande de Canadá: una metrópolis a orillas del lago con barrios con personalidad propia, museos de talla mundial y una de las escenas gastronómicas más diversas del planeta.",
    imageUrl: 'https://picsum.photos/seed/triplanner-toronto/800/600',
    lat: 43.6532,
    lng: -79.3832,
  },
  {
    slug: 'panama-city',
    name: 'Panamá',
    country: 'Panamá',
    description:
      'Donde el Pacífico se encuentra con el Caribe: una ciudad de rascacielos, el encanto colonial de Casco Viejo, la maravilla del Canal de Panamá y la selva a las puertas de casa.',
    imageUrl: 'https://picsum.photos/seed/triplanner-panama/800/600',
    lat: 8.9824,
    lng: -79.5199,
  },
];

export const seedActivities: Record<string, Activity[]> = {
  toronto: [
    { id: 'tor-cn-tower', name: 'CN Tower', category: 'sight', cost: 43, lat: 43.6426, lng: -79.3871, description: 'Torre icónica de 553 m con suelo de cristal, miradores y vistas de 360° de la ciudad y el lago.', tags: ['iconic', 'views', 'family'], durationHours: 2, imageUrl: 'https://picsum.photos/seed/triplanner-cntower/800/600', rating: 4.6 },
    { id: 'tor-edgewalk', name: 'CN Tower EdgeWalk', category: 'activity', cost: 225, lat: 43.6426, lng: -79.3871, description: 'Paseo sin manos por el borde exterior de la CN Tower, a 356 m de altura. La emoción de una vida.', tags: ['adrenaline', 'unique'], durationHours: 1.5, imageUrl: 'https://picsum.photos/seed/triplanner-edgewalk/800/600', rating: 4.9 },
    { id: 'tor-ripleys', name: "Ripley's Aquarium of Canada", category: 'sight', cost: 44, lat: 43.6424, lng: -79.386, description: 'Acuario gigante a los pies de la CN Tower con una pasarela móvil a través de un túnel de tiburones.', tags: ['family', 'indoor', 'marine'], durationHours: 2.5, imageUrl: 'https://picsum.photos/seed/triplanner-ripleys/800/600', rating: 4.5 },
    { id: 'tor-rom', name: 'Royal Ontario Museum', category: 'sight', cost: 26, lat: 43.6677, lng: -79.3948, description: 'El museo más grande de Canadá: dinosaurios, culturas del mundo y la llamativa fachada de cristal.', tags: ['museum', 'indoor', 'culture'], durationHours: 3, imageUrl: 'https://picsum.photos/seed/triplanner-rom/800/600', rating: 4.6 },
    { id: 'tor-ago', name: 'Art Gallery of Ontario', category: 'sight', cost: 30, lat: 43.6536, lng: -79.3925, description: 'Galería rediseñada por Frank Gehry con arte canadiense, el Group of Seven y grandes exposiciones.', tags: ['art', 'museum', 'indoor'], durationHours: 2.5, imageUrl: 'https://picsum.photos/seed/triplanner-ago/800/600', rating: 4.7 },
    { id: 'tor-casa-loma', name: 'Casa Loma', category: 'sight', cost: 40, lat: 43.678, lng: -79.4094, description: 'Un castillo de estilo gótico victoriano de 98 habitaciones con túneles secretos y jardines.', tags: ['history', 'castle', 'architecture'], durationHours: 2, imageUrl: 'https://picsum.photos/seed/triplanner-casaloma/800/600', rating: 4.4 },
    { id: 'tor-distillery', name: 'Distillery District', category: 'sight', cost: 0, lat: 43.6503, lng: -79.3597, description: 'Antigua destilería victoriana convertida en villa peatonal de galerías, boutiques y terrazas.', tags: ['free', 'walkable', 'photogenic'], durationHours: 2, imageUrl: 'https://picsum.photos/seed/triplanner-distillery/800/600', rating: 4.7 },
    { id: 'tor-st-lawrence', name: 'St. Lawrence Market', category: 'food', cost: 20, lat: 43.6487, lng: -79.3716, description: 'Mercado cubierto histórico famoso por sus sándwiches de lomo, quesos y productos frescos.', tags: ['market', 'lunch', 'local'], durationHours: 1.5, imageUrl: 'https://picsum.photos/seed/triplanner-stlawrence/800/600', rating: 4.7 },
    { id: 'tor-kensington', name: 'Kensington Market', category: 'activity', cost: 0, lat: 43.6547, lng: -79.4007, description: 'Barrio bohemio de tiendas vintage, comida callejera y murales de colores: ideal para pasear.', tags: ['free', 'walkable', 'street-food'], durationHours: 2, imageUrl: 'https://picsum.photos/seed/triplanner-kensington/800/600', rating: 4.6 },
    { id: 'tor-graffiti-alley', name: 'Graffiti Alley', category: 'sight', cost: 0, lat: 43.6472, lng: -79.3978, description: 'Un kilómetro de arte callejero en constante cambio: el callejón más fotografiado de Toronto.', tags: ['free', 'street-art', 'photogenic'], durationHours: 0.75, imageUrl: 'https://picsum.photos/seed/triplanner-graffiti/800/600', rating: 4.5 },
    { id: 'tor-islands', name: 'Toronto Islands Ferry', category: 'activity', cost: 9, lat: 43.6372, lng: -79.3717, description: 'Corto ferry a islas sin coches con playas, alquiler de bicis y las mejores vistas del skyline.', tags: ['outdoors', 'beach', 'skyline'], durationHours: 4, imageUrl: 'https://picsum.photos/seed/triplanner-islands/800/600', rating: 4.8 },
    { id: 'tor-high-park', name: 'High Park', category: 'activity', cost: 0, lat: 43.6465, lng: -79.4637, description: 'El parque más grande de Toronto: senderos, jardines, un mini zoo y cerezos en primavera.', tags: ['free', 'outdoors', 'nature'], durationHours: 2.5, imageUrl: 'https://picsum.photos/seed/triplanner-highpark/800/600', rating: 4.6 },
    { id: 'tor-harbourfront', name: 'Harbourfront Centre', category: 'activity', cost: 0, lat: 43.6387, lng: -79.3814, description: 'Paseo junto al lago con festivales, conciertos gratuitos y alquiler de kayaks en verano.', tags: ['free', 'waterfront', 'events'], durationHours: 2, imageUrl: 'https://picsum.photos/seed/triplanner-harbourfront/800/600', rating: 4.3 },
    { id: 'tor-nathan-phillips', name: 'Nathan Phillips Square', category: 'sight', cost: 0, lat: 43.6525, lng: -79.3835, description: 'La plaza de reunión de la ciudad con el icónico letrero TORONTO y pista de patinaje en invierno.', tags: ['free', 'landmark', 'photo'], durationHours: 0.75, imageUrl: 'https://picsum.photos/seed/triplanner-nps/800/600', rating: 4.4 },
    { id: 'tor-hhof', name: 'Hockey Hall of Fame', category: 'sight', cost: 25, lat: 43.647, lng: -79.3773, description: 'La Stanley Cup y exposiciones interactivas que celebran la historia del hockey.', tags: ['sports', 'museum', 'indoor'], durationHours: 2, imageUrl: 'https://picsum.photos/seed/triplanner-hhof/800/600', rating: 4.6 },
    { id: 'tor-queen-west', name: 'Queen Street West', category: 'activity', cost: 0, lat: 43.6493, lng: -79.3986, description: 'Compras y cafés en una de las calles más cool del mundo.', tags: ['free', 'shopping', 'cafe'], durationHours: 2, imageUrl: 'https://picsum.photos/seed/triplanner-queenwest/800/600', rating: 4.5 },
    { id: 'tor-chinatown', name: 'Chinatown', category: 'food', cost: 15, lat: 43.6529, lng: -79.398, description: 'Uno de los barrios chinos más grandes de Norteamérica: dumplings, panaderías y cenas hasta tarde.', tags: ['cheap-eats', 'street-food', 'dinner'], durationHours: 1.5, imageUrl: 'https://picsum.photos/seed/triplanner-chinatown/800/600', rating: 4.4 },
    { id: 'tor-little-italy', name: 'Little Italy', category: 'food', cost: 20, lat: 43.6553, lng: -79.4148, description: 'Tramo de College Street con trattorias, heladerías y bares de espresso.', tags: ['dinner', 'italian', 'neighbourhood'], durationHours: 2, imageUrl: 'https://picsum.photos/seed/triplanner-littleitaly/800/600', rating: 4.3 },
    { id: 'tor-pai', name: 'Pai Northern Thai Kitchen', category: 'food', cost: 25, lat: 43.6551, lng: -79.4058, description: 'Famoso local de cocina tailandesa del norte: khao soi y pad gra pow en un ambiente animado.', tags: ['thai', 'dinner', 'popular'], durationHours: 1.5, imageUrl: 'https://picsum.photos/seed/triplanner-pai/800/600', rating: 4.6 },
    { id: 'tor-alo', name: 'Alo Restaurant', category: 'food', cost: 110, lat: 43.6472, lng: -79.3933, description: 'La alta cocina más aclamada de Toronto: menú degustación francés sobre una casa victoriana.', tags: ['fine-dining', 'special-occasion', 'tasting-menu'], durationHours: 3, imageUrl: 'https://picsum.photos/seed/triplanner-alo/800/600', rating: 4.8 },
    { id: 'tor-lee', name: 'Lee Restaurant', category: 'food', cost: 60, lat: 43.6466, lng: -79.3906, description: 'La famosa ensalada Singapur de Susur Lee y platos asiáticos modernos para compartir.', tags: ['asian-fusion', 'dinner', 'sharing'], durationHours: 2, imageUrl: 'https://picsum.photos/seed/triplanner-lee/800/600', rating: 4.4 },
    { id: 'tor-bar-raval', name: 'Bar Raval', category: 'nightlife', cost: 20, lat: 43.6553, lng: -79.4111, description: 'Bar de pintxos español inspirado en Gaudí con cócteles serios y energía de pie.', tags: ['cocktails', 'tapas', 'late'], durationHours: 2, imageUrl: 'https://picsum.photos/seed/triplanner-barraval/800/600', rating: 4.5 },
    { id: 'tor-drake', name: 'The Drake Hotel', category: 'nightlife', cost: 15, lat: 43.6448, lng: -79.4209, description: 'Institución de West Queen West: música en vivo, exposiciones de arte y una terraza animada.', tags: ['live-music', 'rooftop', 'bar'], durationHours: 2.5, imageUrl: 'https://picsum.photos/seed/triplanner-drake/800/600', rating: 4.4 },
    { id: 'tor-scotiabank', name: 'Scotiabank Arena Game Night', category: 'activity', cost: 60, lat: 43.6414, lng: -79.3893, description: 'Ve a los Maple Leafs o Raptors en el ambiente eléctrico del centro de Toronto.', tags: ['sports', 'evening', 'events'], durationHours: 3, imageUrl: 'https://picsum.photos/seed/triplanner-scotiabank/800/600', rating: 4.7 },
    { id: 'tor-zoo', name: 'Toronto Zoo', category: 'activity', cost: 36, lat: 43.8204, lng: -79.1822, description: 'Uno de los zoológicos más grandes del mundo con más de 5.000 animales en 280 hectáreas.', tags: ['family', 'outdoors', 'animals'], durationHours: 4, imageUrl: 'https://picsum.photos/seed/triplanner-zoo/800/600', rating: 4.5 },
    { id: 'tor-kayak', name: 'Kayak the Harbourfront', category: 'activity', cost: 35, lat: 43.6385, lng: -79.3805, description: 'Rema por el puerto interior y alrededor de las islas para una vista fresca del skyline.', tags: ['water', 'outdoors', 'active'], durationHours: 2, imageUrl: 'https://picsum.photos/seed/triplanner-kayak/800/600', rating: 4.6 },
  ],
  'panama-city': [
    { id: 'pan-casco', name: 'Casco Viejo Walking Tour', category: 'sight', cost: 0, lat: 8.9526, lng: -79.535, description: 'Recorre las calles empedradas del casco antiguo declarado Patrimonio de la Humanidad.', tags: ['free', 'history', 'walkable'], durationHours: 2.5, imageUrl: 'https://picsum.photos/seed/triplanner-casco/800/600', rating: 4.7 },
    { id: 'pan-miraflores', name: 'Miraflores Locks Visitor Center', category: 'sight', cost: 18, lat: 8.997, lng: -79.5901, description: 'Observa los enormes barcos cruzar el Canal desde las terrazas y las exhibiciones.', tags: ['iconic', 'canal', 'engineering'], durationHours: 2.5, imageUrl: 'https://picsum.photos/seed/triplanner-miraflores/800/600', rating: 4.7 },
    { id: 'pan-canal-transit', name: 'Panama Canal Partial Transit', category: 'activity', cost: 160, lat: 8.9346, lng: -79.5573, description: 'Travesía en barco de medio día por las esclusas del Pacífico: la experiencia definitiva del Canal.', tags: ['canal', 'boat', 'bucket-list'], durationHours: 5, imageUrl: 'https://picsum.photos/seed/triplanner-canal/800/600', rating: 4.8 },
    { id: 'pan-biomuseo', name: 'Biomuseo', category: 'sight', cost: 18, lat: 8.9312, lng: -79.5473, description: 'El colorido museo de la biodiversidad de Frank Gehry en la entrada de la Calzada de Amador.', tags: ['museum', 'architecture', 'family'], durationHours: 1.5, imageUrl: 'https://picsum.photos/seed/triplanner-biomuseo/800/600', rating: 4.4 },
    { id: 'pan-amador', name: 'Amador Causeway', category: 'activity', cost: 0, lat: 8.9321, lng: -79.5473, description: 'Calzada panorámica entre islas con alquiler de bicis, puertos deportivos y vistas del skyline.', tags: ['free', 'bike', 'waterfront'], durationHours: 2, imageUrl: 'https://picsum.photos/seed/triplanner-amador/800/600', rating: 4.6 },
    { id: 'pan-cinta', name: 'Cinta Costera', category: 'activity', cost: 0, lat: 8.9743, lng: -79.5203, description: 'Parque urbano junto a la bahía con senderos para correr, canchas y brisa marina.', tags: ['free', 'sunset', 'jogging'], durationHours: 1.5, imageUrl: 'https://picsum.photos/seed/triplanner-cinta/800/600', rating: 4.3 },
    { id: 'pan-ancon', name: 'Ancon Hill', category: 'activity', cost: 0, lat: 8.957, lng: -79.549, description: 'Caminata empinada de 45 minutos hasta la bandera panameña: perezosos, tucanes y vistas.', tags: ['free', 'hike', 'wildlife'], durationHours: 2.5, imageUrl: 'https://picsum.photos/seed/triplanner-ancon/800/600', rating: 4.7 },
    { id: 'pan-metropolitan', name: 'Metropolitan Natural Park', category: 'activity', cost: 5, lat: 8.991, lng: -79.541, description: 'Reserva de selva a minutos del centro: avistamiento de monos y perezosos en senderos marcados.', tags: ['nature', 'wildlife', 'hike'], durationHours: 3, imageUrl: 'https://picsum.photos/seed/triplanner-metro/800/600', rating: 4.5 },
    { id: 'pan-viejo', name: 'Panama Viejo Ruins', category: 'sight', cost: 10, lat: 9.0062, lng: -79.4853, description: 'Restos de la ciudad original de 1519 saqueada por piratas, con torre de catedral escalable.', tags: ['history', 'ruins', 'unesco'], durationHours: 2, imageUrl: 'https://picsum.photos/seed/triplanner-viejo/800/600', rating: 4.4 },
    { id: 'pan-san-blas', name: 'San Blas Islands Day Trip', category: 'activity', cost: 150, lat: 9.0013, lng: -79.531, description: 'Archipiélago paradisíaco de Guna Yala: arena blanca, arrecifes de coral y agua cristalina.', tags: ['beach', 'islands', 'bucket-list'], durationHours: 12, imageUrl: 'https://picsum.photos/seed/triplanner-sanblas/800/600', rating: 4.9 },
    { id: 'pan-gatun', name: 'Gatun Lake Monkey Island Tour', category: 'activity', cost: 90, lat: 9.1609, lng: -79.8375, description: 'Tour en bote por el lago del Canal para ver monos capuchinos, perezosos y cocodrilos de cerca.', tags: ['wildlife', 'boat', 'nature'], durationHours: 4, imageUrl: 'https://picsum.photos/seed/triplanner-gatun/800/600', rating: 4.6 },
    { id: 'pan-embera', name: 'Embera Village Visit', category: 'activity', cost: 120, lat: 9.0214, lng: -79.4851, description: 'Canoa hasta una comunidad indígena Embera: danza, artesanía y un almuerzo tradicional.', tags: ['culture', 'indigenous', 'unique'], durationHours: 6, imageUrl: 'https://picsum.photos/seed/triplanner-embera/800/600', rating: 4.7 },
    { id: 'pan-taboga', name: 'Isla Taboga Day Trip', category: 'activity', cost: 24, lat: 8.929, lng: -79.535, description: 'Ferry a la "Isla de las Flores": playas, senderismo y marisco fresco a una hora de la ciudad.', tags: ['beach', 'ferry', 'day-trip'], durationHours: 6, imageUrl: 'https://picsum.photos/seed/triplanner-taboga/800/600', rating: 4.5 },
    { id: 'pan-mariscos', name: 'Mercado de Mariscos', category: 'food', cost: 15, lat: 8.9631, lng: -79.535, description: 'El mercado de pescado: ceviche fresco y barato en vasos, de pie entre la pesca del día.', tags: ['ceviche', 'cheap-eats', 'local'], durationHours: 1, imageUrl: 'https://picsum.photos/seed/triplanner-mariscos/800/600', rating: 4.5 },
    { id: 'pan-fonda', name: 'Fonda Lo Que Hay', category: 'food', cost: 25, lat: 8.9829, lng: -79.5234, description: 'Cocina panameña moderna de una cocina joven celebrada: creativa, local y divertida.', tags: ['local', 'dinner', 'modern'], durationHours: 2, imageUrl: 'https://picsum.photos/seed/triplanner-fonda/800/600', rating: 4.6 },
    { id: 'pan-maito', name: 'Maito', category: 'food', cost: 60, lat: 8.9829, lng: -79.5185, description: 'El restaurante más famoso de Panamá: versiones elevadas de los clásicos caribeños.', tags: ['fine-dining', 'caribbean', 'special-occasion'], durationHours: 2.5, imageUrl: 'https://picsum.photos/seed/triplanner-maito/800/600', rating: 4.6 },
    { id: 'pan-donde-jose', name: 'Donde Jose', category: 'food', cost: 85, lat: 8.9536, lng: -79.5346, description: 'Íntimo restaurante de menú degustación en Casco Viejo que cuenta la historia de Panamá.', tags: ['tasting-menu', 'fine-dining', 'unique'], durationHours: 3, imageUrl: 'https://picsum.photos/seed/triplanner-dondejose/800/600', rating: 4.7 },
    { id: 'pan-tantalo', name: 'Tantalo Rooftop', category: 'nightlife', cost: 15, lat: 8.9533, lng: -79.5353, description: 'Animada azotea en Casco Viejo con vistas al skyline y la bahía: favorito del happy hour.', tags: ['rooftop', 'cocktails', 'sunset'], durationHours: 2, imageUrl: 'https://picsum.photos/seed/triplanner-tantalo/800/600', rating: 4.5 },
    { id: 'pan-casacasco', name: 'CasaCasco', category: 'nightlife', cost: 20, lat: 8.9531, lng: -79.535, description: 'Cinco pisos de bares y restaurantes en una mansión colonial, coronados por una azotea con baile.', tags: ['club', 'rooftop', 'multi-level'], durationHours: 3, imageUrl: 'https://picsum.photos/seed/triplanner-casacasco/800/600', rating: 4.4 },
    { id: 'pan-selina', name: 'Selina Casco Viejo', category: 'nightlife', cost: 12, lat: 8.9532, lng: -79.5343, description: 'Híbrido de hostal y bar con música en vivo cada noche, clases de salsa y ambiente viajero.', tags: ['live-music', 'salsa', 'social'], durationHours: 2.5, imageUrl: 'https://picsum.photos/seed/triplanner-selina/800/600', rating: 4.3 },
    { id: 'pan-teatro', name: 'Teatro Nacional', category: 'sight', cost: 5, lat: 8.9528, lng: -79.5346, description: 'Ornamentado teatro de ópera de 1908 con techos al fresco: visita o disfruta de un espectáculo.', tags: ['architecture', 'culture', 'theatre'], durationHours: 1, imageUrl: 'https://picsum.photos/seed/triplanner-teatro/800/600', rating: 4.5 },
    { id: 'pan-altar', name: 'Iglesia San José y el Altar Dorado', category: 'sight', cost: 0, lat: 8.9535, lng: -79.5341, description: 'Iglesia barroca que esconde el altar dorado salvado del pirata Henry Morgan.', tags: ['free', 'history', 'church'], durationHours: 0.5, imageUrl: 'https://picsum.photos/seed/triplanner-altar/800/600', rating: 4.4 },
    { id: 'pan-plaza-francia', name: 'Plaza Francia', category: 'sight', cost: 0, lat: 8.9538, lng: -79.5352, description: 'Plaza junto al mar que honra a los constructores franceses del Canal: el mejor atardecer de Casco.', tags: ['free', 'sunset', 'views'], durationHours: 1, imageUrl: 'https://picsum.photos/seed/triplanner-plazafrancia/800/600', rating: 4.6 },
    { id: 'pan-punta-culebra', name: 'Punta Culebra Nature Center', category: 'activity', cost: 8, lat: 8.9108, lng: -79.5275, description: 'Centro marino del Smithsonian con piscinas de marea, bosque de perezosos y tanques táctiles.', tags: ['marine', 'family', 'nature'], durationHours: 2, imageUrl: 'https://picsum.photos/seed/triplanner-culebra/800/600', rating: 4.5 },
    { id: 'pan-cafe-unido', name: 'Cafe Unido', category: 'food', cost: 10, lat: 8.9845, lng: -79.5205, description: 'Pionero del café de especialidad panameño: pour-overs de geisha y desayunos.', tags: ['coffee', 'breakfast', 'cafe'], durationHours: 1, imageUrl: 'https://picsum.photos/seed/triplanner-unido/800/600', rating: 4.6 },
    { id: 'pan-rana', name: 'La Rana Dorada', category: 'nightlife', cost: 12, lat: 8.9848, lng: -79.521, description: 'Pub de cerveza artesanal que sirve ales y lagers doradas locales con un happy hour animado.', tags: ['craft-beer', 'pub', 'casual'], durationHours: 2, imageUrl: 'https://picsum.photos/seed/triplanner-rana/800/600', rating: 4.4 },
  ],
};

interface SeedItemInput {
  day: string;
  order: number;
  title: string;
  category: string;
  cost: number;
  activityId?: string | null;
  startTime?: string | null;
  notes?: string | null;
  imageUrl?: string | null;
  id?: string;
  addedBy?: string;
}

function item(partial: SeedItemInput): TripItem {
  return {
    id: partial.id ?? uid(),
    addedBy: partial.addedBy ?? CURRENT_USER_ID,
    day: partial.day,
    order: partial.order,
    activityId: partial.activityId ?? null,
    title: partial.title,
    category: partial.category,
    cost: partial.cost,
    startTime: partial.startTime ?? null,
    notes: partial.notes ?? null,
    imageUrl: partial.imageUrl ?? null,
  };
}

function member(
  userId: string,
  role: Member['role'],
  joinedAt: string,
): Member {
  const u = SEED_USERS[userId];
  return { userId, displayName: u.displayName, email: u.email, role, joinedAt };
}

export function buildSeedTrips(): Trip[] {
  const now = nowIso();

  const torontoId = 'trip-toronto-wknd';
  const torontoItems: TripItem[] = [
    item({ day: '2026-10-16', order: 0, title: 'Vuelo a Toronto', category: 'transporte', cost: 620, startTime: '09:30', addedBy: 'user-marco' }),
    item({ day: '2026-10-16', order: 1, activityId: 'tor-cn-tower', title: 'CN Tower', category: 'sight', cost: 43, startTime: '15:00', imageUrl: 'https://picsum.photos/seed/triplanner-cntower/800/600', addedBy: 'user-sofia' }),
    item({ day: '2026-10-17', order: 0, activityId: 'tor-rom', title: 'Royal Ontario Museum', category: 'sight', cost: 26, startTime: '10:00', imageUrl: 'https://picsum.photos/seed/triplanner-rom/800/600', addedBy: 'user-valeria' }),
    item({ day: '2026-10-17', order: 1, activityId: 'tor-bar-raval', title: 'Bar Raval', category: 'nightlife', cost: 20, startTime: '21:00', imageUrl: 'https://picsum.photos/seed/triplanner-barraval/800/600', addedBy: 'user-marco' }),
    item({ day: '2026-10-18', order: 0, activityId: 'tor-islands', title: 'Toronto Islands Ferry', category: 'activity', cost: 9, startTime: '11:00', imageUrl: 'https://picsum.photos/seed/triplanner-islands/800/600', addedBy: 'user-sofia' }),
    item({ day: '2026-10-18', order: 1, activityId: 'tor-ripleys', title: "Ripley's Aquarium", category: 'sight', cost: 44, startTime: '14:00', imageUrl: 'https://picsum.photos/seed/triplanner-ripleys/800/600', addedBy: 'user-diego' }),
    item({ day: '2026-10-18', order: 2, activityId: 'tor-pai', title: 'Pai Northern Thai Kitchen', category: 'food', cost: 25, startTime: '19:30', imageUrl: 'https://picsum.photos/seed/triplanner-pai/800/600', addedBy: 'user-valeria' }),
    item({ day: '2026-10-19', order: 0, activityId: 'tor-casa-loma', title: 'Casa Loma', category: 'sight', cost: 40, startTime: '10:30', imageUrl: 'https://picsum.photos/seed/triplanner-casaloma/800/600', addedBy: 'user-marco' }),
    item({ day: '2026-10-19', order: 1, activityId: 'tor-drake', title: 'The Drake Hotel', category: 'nightlife', cost: 15, startTime: '22:00', imageUrl: 'https://picsum.photos/seed/triplanner-drake/800/600', addedBy: 'user-sofia' }),
    item({ day: '2026-10-20', order: 0, title: 'Hotel — 5 noches', category: 'alojamiento', cost: 650, addedBy: 'user-marco' }),
  ];

  const toronto: Trip = {
    id: torontoId,
    name: 'Toronto — Fin de semana',
    destinationId: 'toronto',
    destinationName: 'Toronto',
    startDate: '2026-10-16',
    endDate: '2026-10-20',
    totalBudget: 1800,
    spent: 0,
    spentByCategory: [],
    ownerId: 'user-marco',
    inviteCode: inviteCodeFor(torontoId),
    members: [
      member('user-marco', 'owner', now),
      member('user-sofia', 'editor', now),
      member('user-diego', 'viewer', now),
      member('user-valeria', 'editor', now),
    ],
    items: torontoItems,
    myRole: 'owner',
    createdAt: now,
    updatedAt: now,
  };

  const panamaId = 'trip-panama-escape';
  const panamaItems: TripItem[] = [
    item({ day: '2026-11-06', order: 0, title: 'Vuelo a Panamá', category: 'transporte', cost: 380, startTime: '08:00', addedBy: 'user-marco' }),
    item({ day: '2026-11-06', order: 1, activityId: 'pan-casco', title: 'Casco Viejo Walking Tour', category: 'sight', cost: 0, startTime: '15:00', imageUrl: 'https://picsum.photos/seed/triplanner-casco/800/600', addedBy: 'user-mateo' }),
    item({ day: '2026-11-07', order: 0, activityId: 'pan-miraflores', title: 'Miraflores Locks', category: 'sight', cost: 18, startTime: '10:00', imageUrl: 'https://picsum.photos/seed/triplanner-miraflores/800/600', addedBy: 'user-sofia' }),
    item({ day: '2026-11-07', order: 1, activityId: 'pan-mariscos', title: 'Mercado de Mariscos', category: 'food', cost: 15, startTime: '13:30', imageUrl: 'https://picsum.photos/seed/triplanner-mariscos/800/600', addedBy: 'user-marco' }),
    item({ day: '2026-11-07', order: 2, activityId: 'pan-tantalo', title: 'Tantalo Rooftop', category: 'nightlife', cost: 15, startTime: '21:00', imageUrl: 'https://picsum.photos/seed/triplanner-tantalo/800/600', addedBy: 'user-sofia' }),
    item({ day: '2026-11-08', order: 0, title: 'Hotel — 3 noches', category: 'alojamiento', cost: 210, addedBy: 'user-marco' }),
    item({ day: '2026-11-08', order: 1, activityId: 'pan-taboga', title: 'Isla Taboga Day Trip', category: 'activity', cost: 24, startTime: '09:00', imageUrl: 'https://picsum.photos/seed/triplanner-taboga/800/600', addedBy: 'user-mateo' }),
  ];

  const panama: Trip = {
    id: panamaId,
    name: 'Panamá — Escapada',
    destinationId: 'panama-city',
    destinationName: 'Panamá',
    startDate: '2026-11-06',
    endDate: '2026-11-08',
    totalBudget: 950,
    spent: 0,
    spentByCategory: [],
    ownerId: 'user-marco',
    inviteCode: inviteCodeFor(panamaId),
    members: [
      member('user-marco', 'owner', now),
      member('user-mateo', 'viewer', now),
      member('user-sofia', 'editor', now),
    ],
    items: panamaItems,
    myRole: 'owner',
    createdAt: now,
    updatedAt: now,
  };

  return [toronto, panama];
}
