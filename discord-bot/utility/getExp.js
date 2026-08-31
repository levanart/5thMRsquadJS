function getExp(user) {
  const {
    kills: expForKills,
    death: expForDeath,
    revives: expForRevives,
    teamkills: expForTeamkills,
  } = user;
  const {
    cmd: expForCmd,
    leader: expForLeader,
    timeplayed: expForTime,
  } = user.squad;
  const { won: expForWin, lose: expForLose } = user.matches;
  let exp =
    expForTime +
    expForKills * 7 +
    expForRevives * 7 -
    expForDeath -
    expForTeamkills * 10 +
    expForLeader * 5 +
    expForCmd * 7 +
    expForWin * 25 -
    expForLose * 25;
  if (exp > 0 && exp < 5000) {
    const rankPct = exp / 5000;
    const rankStr = 'Рядовой';
    const img = 'firstRank';
    const rankImg = 'Private';
    const expProgress = `${exp} / 5000`;
    return { rankPct, rankStr, expProgress, img, rankImg };
  }
  if (exp > 5000 && exp < 10000) {
    const rankPct = exp / 10000;
    const rankStr = 'Eфрейтор';
    const img = 'firstRank';
    const rankImg = 'Private_first_class';
    const expProgress = `${exp} / 10000`;
    return { rankPct, rankStr, expProgress, img, rankImg };
  }
  if (exp > 10000 && exp < 20000) {
    const rankPct = exp / 20000;
    const rankStr = 'Мл. сержант';
    const img = 'secondRank';
    const rankImg = 'Junior_sergeant';
    const expProgress = `${exp} / 20000`;
    return { rankPct, rankStr, expProgress, img, rankImg };
  }
  if (exp > 20000 && exp < 30000) {
    const rankPct = exp / 30000;
    const rankStr = 'Сержант';
    const img = 'secondRank';
    const rankImg = 'Sergeant';
    const expProgress = `${exp} / 30000`;
    return { rankPct, rankStr, expProgress, img, rankImg };
  }
  if (exp > 30000 && exp < 40000) {
    const rankPct = exp / 40000;
    const rankStr = 'Ст. сержант';
    const img = 'secondRank';
    const rankImg = 'Senior_sergeant';
    const expProgress = `${exp} / 40000`;
    return { rankPct, rankStr, expProgress, img, rankImg };
  }
  if (exp > 40000 && exp < 60000) {
    const rankPct = exp / 60000;
    const rankStr = 'Старшина';
    const img = 'secondRank';
    const rankImg = 'Master_sergeant';
    const expProgress = `${exp} / 60000`;
    return { rankPct, rankStr, expProgress, img, rankImg };
  }
  if (exp > 60000 && exp < 80000) {
    const rankPct = exp / 80000;
    const rankStr = 'Прапорщик';
    const img = 'thirdRank';
    const rankImg = 'Warrant_officer';
    const expProgress = `${exp} / 80000`;
    return { rankPct, rankStr, expProgress, img, rankImg };
  }
  if (exp > 80000 && exp < 100000) {
    const rankPct = exp / 100000;
    const rankStr = 'Ст. прапорщик';
    const img = 'thirdRank';
    const rankImg = 'Senior_warrant_officer';
    const expProgress = `${exp} / 100000`;
    return { rankPct, rankStr, expProgress, img, rankImg };
  }
  if (exp > 100000 && exp < 120000) {
    const rankPct = exp / 120000;
    const rankStr = 'Мл. лейтенант';
    const img = 'fourthRank';
    const rankImg = 'Junior_lieutenant';
    const expProgress = `${exp} / 120000`;
    return { rankPct, rankStr, expProgress, img, rankImg };
  }
  if (exp > 120000 && exp < 140000) {
    const rankPct = exp / 140000;
    const rankStr = 'Лейтенант';
    const img = 'fourthRank';
    const rankImg = 'Lieutenant';
    const expProgress = `${exp} / 140000`;
    return { rankPct, rankStr, expProgress, img, rankImg };
  }
  if (exp > 140000 && exp < 160000) {
    const rankPct = exp / 160000;
    const rankStr = 'Ст. лейтенант';
    const img = 'fourthRank';
    const rankImg = 'Senior_lieutenant';
    const expProgress = `${exp} / 160000`;
    return { rankPct, rankStr, expProgress, img, rankImg };
  }
  if (exp > 160000 && exp < 180000) {
    const rankPct = exp / 180000;
    const rankStr = 'Капитан';
    const img = 'fourthRank';
    const rankImg = 'Captain';
    const expProgress = `${exp} / 180000`;
    return { rankPct, rankStr, expProgress, img, rankImg };
  }
  if (exp > 180000 && exp < 240000) {
    const rankPct = exp / 240000;
    const rankStr = 'Майор';
    const img = 'fifthRank';
    const rankImg = 'Major';
    const expProgress = `${exp} / 240000`;
    return { rankPct, rankStr, expProgress, img, rankImg };
  }
  if (exp > 240000 && exp < 280000) {
    const rankPct = exp / 280000;
    const rankStr = 'Подполковник';
    const img = 'fifthRank';
    const rankImg = 'Lieutenant_colonel';
    const expProgress = `${exp} / 280000`;
    return { rankPct, rankStr, expProgress, img, rankImg };
  }
  if (exp > 280000 && exp < 340000) {
    const rankPct = exp / 340000;
    const rankStr = 'Полковник';
    const img = 'fifthRank';
    const rankImg = 'Colonel';
    const expProgress = `${exp} / 340000`;
    return { rankPct, rankStr, expProgress, img, rankImg };
  }
  if (exp > 340000 && exp < 380000) {
    const rankPct = exp / 380000;
    const rankStr = 'Ген. майор';
    const img = 'sixthRank';
    const rankImg = 'Major_general';
    const expProgress = `${exp} / 380000`;
    return { rankPct, rankStr, expProgress, img, rankImg };
  }
  if (exp > 380000 && exp < 440000) {
    const rankPct = exp / 440000;
    const rankStr = 'Ген. лейтенант';
    const img = 'sixthRank';
    const rankImg = 'Lieutenant_general';
    const expProgress = `${exp} / 440000`;
    return { rankPct, rankStr, expProgress, img, rankImg };
  }
  if (exp > 440000 && exp < 500000) {
    const rankPct = exp / 500000;
    const rankStr = 'Ген. полковник';
    const img = 'sixthRank';
    const rankImg = 'Colonel_general';
    const expProgress = `${exp} / 500000`;
    return { rankPct, rankStr, expProgress, img, rankImg };
  }
  if (exp > 500000 && exp < 600000) {
    const rankPct = exp / 600000;
    const rankStr = 'Генерал';
    const img = 'sixthRank';
    const rankImg = 'General';
    const expProgress = `${exp} / 600000`;
    return { rankPct, rankStr, expProgress, img, rankImg };
  }
  if (exp > 600000) {
    const rankPct = 1;
    const rankStr = 'Маршал';
    const img = 'sixthRank';
    const rankImg = 'Marshal';
    const expProgress = `${exp}`;
    return { rankPct, rankStr, expProgress, img, rankImg };
  }
}

export default getExp;
