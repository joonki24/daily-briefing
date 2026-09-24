/**
 * 장소명(예: "강남역", "판교테크노밸리 정문")을 좌표로 변환 (카카오 로컬 API).
 * @returns {{lat:number, lon:number, roadAddress:string, placeName:string}}
 */
export async function geocodePlace(query) {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) throw new Error("KAKAO_REST_API_KEY가 설정되지 않았습니다 (.env 확인)");

  const url = new URL("https://dapi.kakao.com/v2/local/search/keyword.json");
  url.searchParams.set("query", query);
  url.searchParams.set("size", "1");

  const res = await fetch(url, { headers: { Authorization: `KakaoAK ${key}` } });
  if (!res.ok) throw new Error(`카카오 장소 검색 실패: ${res.status}`);
  const json = await res.json();

  const doc = json.documents?.[0];
  if (!doc) throw new Error(`"${query}"에 해당하는 장소를 찾지 못했습니다.`);

  return {
    lat: Number(doc.y),
    lon: Number(doc.x),
    roadAddress: doc.road_address_name || doc.address_name,
    placeName: doc.place_name,
  };
}

/**
 * 대중교통 최단(최적) 경로를 ODsay API로 조회.
 */
export async function fetchTransitRoute(fromLat, fromLon, toLat, toLon) {
  const key = process.env.ODSAY_API_KEY;
  if (!key) throw new Error("ODSAY_API_KEY가 설정되지 않았습니다 (.env 확인)");

  const url = new URL("https://api.odsay.com/v1/api/searchPubTransPathT");
  url.searchParams.set("SX", String(fromLon));
  url.searchParams.set("SY", String(fromLat));
  url.searchParams.set("EX", String(toLon));
  url.searchParams.set("EY", String(toLat));
  url.searchParams.set("apiKey", key);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`ODsay API 호출 실패: ${res.status}`);
  const json = await res.json();

  if (json.error) {
    throw new Error(`ODsay API 오류: ${json.error?.[0]?.message ?? JSON.stringify(json.error)}`);
  }

  const paths = json.result?.path ?? [];
  if (paths.length === 0) {
    throw new Error("대중교통 경로를 찾지 못했습니다 (출발지/도착지가 너무 가깝거나 대중교통 미지원 지역일 수 있음).");
  }

  // ODsay는 기본적으로 추천도 순으로 정렬해서 반환하므로 첫 번째를 최적 경로로 사용.
  const best = paths[0];
  const steps = (best.subPath ?? [])
    .map((s) => {
      // trafficType: 1=지하철, 2=버스, 3=도보
      if (s.trafficType === 1) return `지하철 ${s.lane?.[0]?.name ?? ""} (${s.startName}→${s.endName}, ${s.stationCount}개역)`;
      if (s.trafficType === 2) return `버스 ${s.lane?.[0]?.busNo ?? ""} (${s.startName}→${s.endName})`;
      if (s.trafficType === 3) return `도보 ${s.distance}m (약 ${s.sectionTime}분)`;
      return null;
    })
    .filter(Boolean);

  return {
    totalTimeMin: best.info?.totalTime,
    // ODsay의 info.totalWalk는 "분"이 아니라 "도보 거리(m)"다 — 실제 호출로 확인함
    // (totalWalkTime 필드는 이 엔드포인트에서 -1로 비어있어 쓸 수 없음).
    totalWalkMeters: best.info?.totalWalk,
    transferCount: best.info?.busTransitCount + best.info?.subwayTransitCount,
    payment: best.info?.payment,
    steps,
  };
}

/**
 * 최단 대중교통 경로를 사람이 읽기 좋은 텍스트로 포맷팅.
 * 이미 확정된 숫자·경로 데이터라 LLM을 쓰지 않고 템플릿으로 조립한다.
 */
export async function getRouteBrief(fromLat, fromLon, toPlace) {
  const dest = await geocodePlace(toPlace);
  const route = await fetchTransitRoute(fromLat, fromLon, dest.lat, dest.lon);

  if (!Number.isFinite(Number(route.totalTimeMin))) {
    throw new Error("경로 데이터가 비정상입니다 (총 소요시간 값 없음).");
  }

  const brief = formatRouteBrief(dest, route);
  return { destination: dest, route, brief };
}

function formatRouteBrief(dest, route) {
  const header = `🚌 ${dest.placeName}까지 총 ${route.totalTimeMin}분 (도보 ${route.totalWalkMeters}m 포함) · 환승 ${route.transferCount}회`;
  const stepsLine = route.steps.join(" → ");
  const paymentLine = `예상 요금 ${route.payment}원`;
  return [header, stepsLine, paymentLine].join("\n");
}
