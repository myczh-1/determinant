# Benchmark Report

Contract: `sha256:5185e5a5ccfe22b42898ce570e55558832405caa0b3e4f03231db7434d9f2a10`
Oracle: `sha256:201c385a2eeb93bcbaff3ccfca73212f370ae204d5bd54f21950f293ffa80ce5`

## Overview

| Mode | Submissions | Build | Start | Full oracle pass | Oracle cases | Median review lines |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| direct | 4 | 4 | 4 | 4 | 56/56 | 124 |
| aal | 5 | 5 | 5 | 5 | 70/70 | 104 |

## Submissions

| Submission | Build | Start | Oracle | Fully passed | Review files | Non-blank lines | Fingerprint |
| --- | --- | --- | ---: | --- | ---: | ---: | --- |
| aal/codex-5.6luna/001 | PASS | PASS | 14/14 | YES | 1 | 104 | `45d256cf00bc` |
| aal/omp-deepseek-v4/001 | PASS | PASS | 14/14 | YES | 1 | 104 | `45d256cf00bc` |
| aal/opencode-deepseek-v4/001 | PASS | PASS | 14/14 | YES | 1 | 104 | `45d256cf00bc` |
| aal/opencode-glm5-2/001 | PASS | PASS | 14/14 | YES | 1 | 104 | `45d256cf00bc` |
| aal/reference/001 | PASS | PASS | 14/14 | YES | 1 | 104 | `45d256cf00bc` |
| direct/codex-5.6luna/001 | PASS | PASS | 14/14 | YES | 1 | 132 | `45d256cf00bc` |
| direct/omp-deepseek-v4/001 | PASS | PASS | 14/14 | YES | 1 | 116 | `45d256cf00bc` |
| direct/opencode-deepseek-v4/001 | PASS | PASS | 14/14 | YES | 1 | 166 | `45d256cf00bc` |
| direct/reference/001 | PASS | PASS | 14/14 | YES | 1 | 77 | `45d256cf00bc` |

## Direct vs AAL

| Tool/run | Comparable | Direct lines | AAL lines | Line reduction | Direct bytes | AAL bytes | Byte reduction |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| codex-5.6luna/001 | YES | 132 | 104 | 21.21% | 3615 | 1917 | 46.97% |
| omp-deepseek-v4/001 | YES | 116 | 104 | 10.34% | 4360 | 1917 | 56.03% |
| opencode-deepseek-v4/001 | YES | 166 | 104 | 37.35% | 4585 | 1917 | 58.19% |
| reference/001 | YES | 77 | 104 | -35.06% | 3197 | 1925 | 39.79% |

Review-surface comparisons are reported only when both paired submissions pass every frozen oracle case.
