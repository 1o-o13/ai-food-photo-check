# 진행 상황과 다음 할 일

마지막 정리: 2026-11-18

## 지금 상태

- **코드**: 이 GitHub 저장소 (`1o-o13/ai-food-photo-check`, `main` 브랜치)
- **배포**: Vercel 프로젝트 `ai-food-photo-check` (계정 jeungcat12-7157, Hobby 플랜)
- **사이트 주소**: https://ai-food-photo-check.vercel.app
- `main`에 push하면 Vercel이 자동으로 다시 배포해요.
- 페이지가 열리고, `/api/analyze`도 동작해요. 사진 없이 요청하면 "사진을 올려주세요" 오류를 정상으로 돌려줘요.
- **API 키는 아직 안 넣었어요.** 그래서 실제 사진 비교는 실패하고 "비교하지 못했어요" 안내가 떠요. 이 상태에서는 요금이 나가지 않아요.

## 다음 할 일 (순서대로)

1. **본인 Anthropic API 키 만들기**: https://console.anthropic.com/settings/keys
   - 다른 프로젝트 키는 쓰지 않기
   - Limits 메뉴에서 월 사용 한도 5~10달러로 걸기
2. **Vercel에 키 넣기**: https://vercel.com/jeungcat12-7157/ai-food-photo-check/settings/environment-variables
   - 이름 `ANTHROPIC_API_KEY`, 값은 위에서 만든 키
   - 저장한 뒤 Deployments 탭에서 맨 위 배포의 ⋯ → Redeploy
3. **실제 사진으로 테스트**: 휴대폰으로 같은 메뉴 / 다른 메뉴 / 음식 아닌 사진을 각각 넣어보기
4. **직접 검토 신청 폼 연결**: Tally(tally.so)로 폼 만들기 → `index.html`의 `const FORM_URL = "";`에 주소 넣기 (폼 질문 예시는 README에 있어요)
5. **하단 페이지 채우기**: 소개, 개인정보처리방침("사진은 비교 후 저장하지 않음" 포함), 문의
6. (추천) **서버 쪽 횟수 제한**: Upstash Redis 연결 (README 4번)

## 다른 컴퓨터에서 이어서 하기

- 키만 넣는 거라면 브라우저로 Vercel에 로그인하면 끝이에요.
- 코드를 고치려면:
  ```
  git clone https://github.com/1o-o13/ai-food-photo-check.git
  ```
- Claude에게는 "이 저장소의 NEXT_STEPS.md 보고 이어서 하자"라고 말하면 돼요.

## 지금까지 결정한 것

- 체크리스트 방식은 뺐어요. **메뉴 사진과 실제 음식 사진 두 장을 비교**하는 방식으로 정했어요.
- AI가 "AI로 만든 사진인지"는 판정하지 않아요. 손님이 "사진이랑 다르다"고 느낄 차이만 짚어요.
- 사진은 브라우저에서 긴 변 1024px로 줄여서 보내고, 서버에 저장하지 않아요.
- 하루 무료 3회예요. 지금은 브라우저에서만 막고 있어요.
