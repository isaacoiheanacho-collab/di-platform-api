// src/utils/geoMapper.js

const zoneNeighbors = {
    1:  [1, 14, 12], // Kano/Jigawa -> Borders Katsina/Kaduna (14) & Bauchi/Gombe (12)
    14: [14, 1, 10], // Katsina/Kaduna -> Borders Kano (1) & Zamfara/Sokoto (10)
    10: [10, 14, 7], // Sokoto/Zamfara -> Borders Katsina/Kaduna (14) & Niger/FCT (7)
    7:  [7, 10, 14], // FCT/Niger -> Borders Zamfara (10) & Kaduna (14)
    2:  [2, 11, 17], // Lagos/Ogun -> Borders Osun/Oyo (11) & Ondo/Ekiti (17)
    11: [11, 2, 8],  // Osun/Oyo -> Borders Lagos/Ogun (2) & Kogi/Kwara (8)
    17: [17, 2, 5],  // Ondo/Ekiti -> Borders Lagos/Ogun (2) & Edo/Delta (5)
    8:  [8, 11, 4],  // Kogi/Kwara -> Borders Oyo (11) & Benue/Plateau (4)
    4:  [4, 7, 8],   // Benue/Plateau -> Borders FCT (7) & Kogi (8)
    12: [12, 1, 15], // Bauchi/Gombe -> Borders Kano (1) & Borno/Yobe (15)
    15: [15, 12, 3], // Borno/Yobe -> Borders Bauchi (12) & Adamawa/Taraba (3)
    3:  [3, 15, 6],  // Adamawa/Taraba -> Borders Borno (15) & Akwa Ibom/Cross River (6)
    5:  [5, 17, 16], // Edo/Delta -> Borders Ondo (17) & Bayelsa/Rivers (16)
    16: [16, 5, 6],  // Bayelsa/Rivers -> Borders Edo/Delta (5) & Cross River (6)
    6:  [6, 16, 9],  // Akwa Ibom/Cross River -> Borders Rivers (16) & Abia/Imo (9)
    9:  [9, 6, 13],  // Abia/Imo/Ebonyi -> Borders Cross River (6) & Enugu/Anambra (13)
    13: [13, 9, 4],  // Enugu/Anambra -> Borders Abia/Ebonyi (9) & Benue (4)
};

const getNeighbors = (zoneId) => {
    return zoneNeighbors[zoneId] || [zoneId];
};

module.exports = { getNeighbors };