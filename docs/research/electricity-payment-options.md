# 전기요금 납부 외부 API 조사

- 조사일: 2026-11-05 / M0·F01 관련 / 공개 문서 조사만 수행.
- 최신 사용자 결정: 금액 조회와 공식 납부 페이지 연결로 충분하다. 실제 결제 API는 이번 MVP에서 제외한다. 기존 PRD의 납부 페이지 연결 범위와 일치한다.

## 조사 결과

| 후보 | 확인된 범위 | 판단 |
|---|---|---|
| NH오픈플랫폼 지로공과금 | 전기료 선조회·납부·납부내역 조회를 공식 소개. 공개 GitHub 명세에 금액·납부기한 응답 존재 | 실제 납부 후보이나 현재 신규 이용·테스트 경로 미확인. 이번 MVP 제외 |
| 금융결제원 오픈지로 | 고지·납부 서비스 및 제휴사/이용기관 구조 | 임의 한전 청구의 납부 API라고 단정할 수 없음. 제휴·위임 범위 확인 필요 |
| 인포텍 공과금 | 전기료 조회와 별도로 일반지로 납부 기능 소개 | 일반지로 납부 지원만으로 전기요금 납부를 지원한다고 간주하지 않음 |
| 하이픈/이노페이 송금대행 | 기업/가맹점의 예치금 기반 지급 기능 | 사용자 계좌에서 바로 전기료를 내는 전용 API와 다름 |
| 한전ON 공식 페이지 연결 | 한전 공식 홈페이지가 요금 조회·납부 고객서비스로 안내 | 이번 MVP 선택. 특정 청구 자동 입력·완료 콜백은 미검증 |

## NH에서 발견한 중요 제약

공식 서비스 소개와 GitHub 명세에 전기료 선조회, 납부, 납부내역 조회가 있다. 선조회 명세에는 전자납부번호·계좌 입력, 금액과 납부기한 반환이 나타난다. 과거 예제이므로 현행 버전으로 그대로 사용하지 않는다. 실조회/납부 키는 확보하지 않았다.

개발가이드 링크는 2025-12-31 개발자센터 종료 안내로 연결된다. 서비스 전체가 종료됐다는 뜻으로 해석하지 않되, 기존 가입 안내만으로 현재 테스트 가능하다고 단정하지 않는다. 정식 이용 안내에는 기관약정·정보보호심사·서비스약정이 있다.

## 확정한 MVP 흐름

1. 지원되는 한전 조회 어댑터로 금액·납부기한을 가져온다. 실접근이 막히면 샘플을 명시한다.
2. 채팅과 카드에 금액·기한·자료 출처·조회 시각을 보여준다.
3. `한전ON에서 납부하기` 버튼으로 공식 HTTPS 페이지를 연다. 구체 경로를 검증하지 못하면 https://online.kepco.co.kr/ 진입 링크를 사용한다.
4. 공식 사이트에서 고객이 로그인·인증하고 직접 납부한다. 우리 앱이 금액·고객번호를 자동 입력한다고 약속하지 않는다.
5. 사용자 납부 확인 전까지 링크 방문만으로 완료 처리하지 않는다. 해당 월 확인 후 남은 알림을 중지한다.

금액 조회는 여전히 별도 인증·API 접근 검증이 필요하다. 결제 API 제외가 조회 API 권한 문제까지 해결하는 것은 아니다. 계좌·개인정보를 URL 파라미터에 임의로 넣지 않는다.

## 근거

- [NH 지로공과금 납부](https://nhfintech.nonghyup.com/content/svcportal/html/nhAPI/AP_9010.html)
- [NH 공개 명세](https://github.com/NH-developers/Giro)
- [NH 개발자센터 종료 안내](https://nhfintech.nonghyup.com/content/svcportal/html/developer_end.html)
- [NH 정식 이용절차](https://nhfintech.nonghyup.com/content/svcportal/html/platform/PL_6010_mail.html)
- [금융결제원 오픈지로](https://openapi.kftc.or.kr/service/openGiro)
- [지로 위임 절차](https://e-giro.giro.or.kr/bbs/faq/qryDetailBoard.do?bUpmu=2&b_id=23&id=faq&level=0)
- [인포텍 공과금](https://www.infotech.co.kr/home/service/Utility-bill-check)
- [하이픈 펌뱅킹](https://hyphen.im/about/service-firm-banking)
- [이노페이 지급대행](https://web.innopay.co.kr/p_instead/)
- [한전 공식 홈페이지](https://www.kepco.co.kr/)
