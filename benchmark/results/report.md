# Benchmark Report

Contract: `sha256:5185e5a5ccfe22b42898ce570e55558832405caa0b3e4f03231db7434d9f2a10`
Oracle: `sha256:201c385a2eeb93bcbaff3ccfca73212f370ae204d5bd54f21950f293ffa80ce5`

## Overview

| Mode | Submissions | Build | Start | Full oracle pass | Oracle cases | Median review lines |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| direct | 1 | 1 | 1 | 1 | 14/14 | 77 |
| aal | 1 | 1 | 1 | 1 | 14/14 | 104 |

## Submissions

| Submission | Build | Start | Oracle | Fully passed | Review files | Non-blank lines | Fingerprint |
| --- | --- | --- | ---: | --- | ---: | ---: | --- |
| aal/reference/001 | PASS | PASS | 14/14 | YES | 1 | 104 | `45d256cf00bc` |
| direct/reference/001 | PASS | PASS | 14/14 | YES | 1 | 77 | `45d256cf00bc` |

## Direct vs AAL

| Tool/run | Comparable | Direct lines | AAL lines | Line reduction | Direct bytes | AAL bytes | Byte reduction |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| reference/001 | YES | 77 | 104 | -35.06% | 3197 | 1925 | 39.79% |

Review-surface comparisons are reported only when both paired submissions pass every frozen oracle case.
