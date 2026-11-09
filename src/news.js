'use strict';
// Featured news shown as the lead article on the home and Publications pages and in the ticker.
// Bodies are French summaries of the source; the original always takes precedence.
const ITEMS = [
  {
    slug: 'ebola-bundibugyo-oms-6-novembre-2026',
    date: '2026-11-06',
    source: { name: 'Organisation mondiale de la Santé (OMS)', title: 'Disease Outbreak News 2026-DON625', url: 'https://www.who.int/emergencies/disease-outbreak-news/item/2026-DON625' },
    kicker: { fr: 'Alerte OMS · Flambée épidémique', en: 'WHO alert · Disease outbreak' },
    title: {
      fr: 'Maladie à virus Bundibugyo (Ebola) : République démocratique du Congo, Kenya et Nigeria',
      en: 'Ebola disease caused by Bundibugyo virus: Democratic Republic of the Congo, Kenya and Nigeria',
    },
    ticker: {
      fr: 'Alerte OMS : Ebola (virus Bundibugyo) en RDC, 10 668 cas confirmés au 3 novembre 2026',
      en: 'WHO alert: Ebola (Bundibugyo virus) in the DRC, 10,668 confirmed cases as of 3 November 2026',
    },
    lead: {
      fr: 'Au 3 novembre 2026, la RDC a notifié 10 668 cas confirmés et 5 198 décès (létalité brute de 48,7 %) dans 67 zones de santé de 8 provinces, avec une transmission toujours active dans 51 zones. Aucun nouveau cas au Kenya ni au Nigeria depuis le précédent bulletin.',
      en: 'As of 3 November 2026 the DRC had reported 10,668 confirmed cases and 5,198 deaths (crude case fatality 48.7%) in 67 health zones across 8 provinces, with active transmission in 51. No new cases in Kenya or Nigeria since the previous bulletin.',
    },
    note: 'Le Burundi partage une frontière terrestre avec la RDC : l’OMS y évalue le risque comme élevé. Pensez à la maladie à virus Bundibugyo devant toute fièvre chez un voyageur ou un contact venant des provinces touchées, et signalez sans délai tout cas suspect.',
    sections: [
      { h: 'La situation en bref', items: [
        'Depuis le bulletin du 23 octobre 2026, l’épidémie s’est étendue géographiquement en RDC. Malgré une légère baisse dans certaines zones, la transmission reste élevée.',
        'Au 3 novembre 2026 : 10 668 cas confirmés et 5 198 décès (létalité brute de 48,7 %) dans 67 zones de santé de 8 provinces ; transmission active dans 51 zones de santé.',
        '512 décès ont été notifiés depuis le 21 octobre : 335 dans la communauté et 177 dans les centres de traitement.',
        'Aucun nouveau cas au Kenya ni au Nigeria, et aucun nouveau pays touché depuis le précédent bulletin. La Suisse et le Royaume-Uni ont procédé à des évacuations sanitaires de cas confirmés.',
        'L’OMS déconseille toute restriction des voyages ou des échanges commerciaux avec les pays touchés.',
      ] },
      { h: 'République démocratique du Congo', items: [
        'Depuis la déclaration de l’épidémie le 15 mai 2026, des cas ont été notifiés dans cinq pays : RDC, France, Kenya, Nigeria et Ouganda. La France et l’Ouganda ont maîtrisé la situation depuis août.',
        'En RDC : 964 nouveaux cas confirmés et 511 nouveaux décès confirmés depuis le 23 octobre.',
        'Au cours des 21 derniers jours (jusqu’au 3 novembre) : 1 463 nouveaux cas confirmés, dont Ituri 710, Nord-Kivu 640, Haut-Uélé 77, Tshopo 31 et Nord-Ubangi 5. Aucun cas au Bas-Uélé, au Sud-Kivu ni au Sud-Ubangi pendant cette période.',
        'Bilan cumulé au 3 novembre : 10 668 cas confirmés, 5 198 décès et 2 881 guérisons.',
        'Par province (cas / décès) : Ituri 7 485 / 3 532 ; Nord-Kivu 2 593 / 1 422 (létalité la plus élevée, 54,8 %) ; Haut-Uélé 470 / 208 ; Tshopo 94 / 29. Au cours des 7 derniers jours, le Nord-Kivu a notifié le plus de cas (232).',
        'Zones de santé touchées (sur le total de la province) : Ituri 28/36, Nord-Kivu 17/34, Haut-Uélé 7/13, Tshopo 7/23, Bas-Uélé 4/11, Nord-Ubangi 2/11, Sud-Kivu 1/34, Sud-Ubangi 1/16. Beni, Bunia et Mandima concentrent le plus de cas et de décès récents ; Yakoma (Nord-Ubangi) est la dernière zone touchée, avec 3 cas confirmés.',
        'Suivi des contacts : en moyenne 86 % des contacts ont été vus chaque jour sur les 14 derniers jours, en dessous du seuil de 95 %. Bas-Uélé (99 %), Nord-Ubangi (95 %) et Sud-Ubangi (95 %) atteignent le seuil ; Ituri (91 %), Haut-Uélé (85 %), Nord-Kivu (82 %) et Tshopo (71 %) restent en dessous.',
        'Un agent de santé, cas confirmé, a été évacué de RDC vers le Royaume-Uni (notifié le 5 novembre) et est soigné à Londres.',
      ] },
      { h: 'Kenya', items: [
        '9 cas confirmés au total (inchangé) et 2 décès, dont un nouveau depuis le dernier bulletin (létalité brute de 22,2 %).',
        'Les huit cas secondaires sont tous liés au cas importé initial, dans un seul foyer : quatre membres de sa famille et quatre agents de santé. Tous étaient déjà en quarantaine comme contacts connus lorsqu’ils ont présenté des symptômes.',
        'Cinq patients sont guéris (sortis le 3 novembre) et deux restent hospitalisés. Aucun nouveau cas depuis le 19 octobre 2026.',
        '135 contacts identifiés : 66 ont terminé leurs 21 jours de suivi et 52 restent surveillés jusqu’au 11 novembre 2026 environ ; neuf ont quitté le pays et leurs autorités ont été informées.',
      ] },
      { h: 'Nigeria', items: [
        'Un cas importé confirmé le 20 octobre 2026 à Abuja (Territoire de la capitale fédérale), évacué le 26 octobre vers Genève, où le patient reste isolé.',
        '62 contacts identifiés au 3 novembre, dont six ont terminé leur suivi de 21 jours. L’enquête se poursuit pour établir la source probable de l’infection.',
      ] },
      { h: 'La maladie', items: [
        'La maladie à virus Bundibugyo est une forme grave de maladie à virus Ebola. C’est une zoonose dont les chauves-souris frugivores seraient le réservoir naturel.',
        'L’infection humaine débute par un contact avec des animaux sauvages infectés (chauves-souris, primates), puis se transmet de personne à personne. Elle est amplifiée dans les structures de soins sans mesures suffisantes de prévention et de contrôle des infections, et lors d’inhumations non sécurisées.',
        'Incubation de 2 à 21 jours. Les patients ne sont pas contagieux avant l’apparition des symptômes, qui sont d’abord peu spécifiques : le paludisme et les autres fièvres sont difficiles à distinguer sans confirmation au laboratoire.',
        'Lors des épidémies précédentes en Ouganda (2007) et en RDC (2012), la létalité était d’environ 30 % et 50 %.',
        'Il n’existe à ce jour ni vaccin homologué ni traitement spécifique.',
        'C’est la deuxième épidémie documentée de virus Bundibugyo en RDC et la plus grande épidémie de maladie à virus Ebola jamais enregistrée dans le pays, toutes espèces virales confondues.',
      ] },
      { h: 'Riposte', items: [
        'RDC : renforcement de la surveillance, des tests, de la prévention des infections, de la prise en charge clinique, de l’engagement communautaire, de la recherche et de la logistique, dans un contexte de crise humanitaire.',
        'Le 23 octobre 2026, l’essai vaccinal de phase 2/3 « Tumaini » a démarré à Bunia. Les experts de l’OMS ont recommandé d’y ajouter deux candidats vaccins : ChAdOx1 (Université d’Oxford et Serum Institute of India) et l’ARNm-1469 de Moderna, après les autorisations nationales.',
        'Kenya : 760 415 voyageurs dépistés aux points d’entrée au 5 novembre ; tests dans cinq laboratoires, dont deux laboratoires mobiles à la frontière ougandaise. Le compte à rebours de 42 jours commencera à la sortie du dernier patient.',
        'Nigeria : activation du système national de gestion des incidents par le NCDC, enquête, recherche des contacts et appui en prévention des infections et équipements de protection.',
      ] },
      { h: 'Évaluation du risque par l’OMS', items: [
        'RDC : risque très élevé.',
        'Pays partageant une frontière terrestre avec la RDC : risque élevé.',
        'Reste de la Région africaine et niveau mondial : risque faible.',
        'L’évaluation rapide des risques est en cours de mise à jour.',
      ] },
      { h: 'Recommandations de l’OMS', items: [
        'Pas de restriction des voyages ni des échanges commerciaux.',
        'Les recommandations temporaires mises à jour le 24 août 2026 insistent sur la coordination de la lutte, la collaboration transfrontalière et une surveillance soutenue.',
        'Le diagnostic rapide, la confirmation au laboratoire et des soins de support optimisés réduisent la mortalité et favorisent l’acceptation des soins par les communautés.',
      ] },
    ],
  },
];

const bySlug = new Map(ITEMS.map((n) => [n.slug, n]));
// The newest item is the lead article.
const lead = () => [...ITEMS].sort((a, b) => b.date.localeCompare(a.date))[0] || null;

module.exports = { ITEMS, bySlug, lead };
