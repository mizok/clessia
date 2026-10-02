# 同一個 head 可能有多筆 verify(重複 push 觸發的那筆會 1 秒就 CANCELLED),
# **取最新一筆的 conclusion**,不要把全部串起來(#1050:串成 CANCELLEDSUCCESS 而誤擋)。
# 還沒開始的(沒有 startedAt)當最新 —— 較新的排隊中 run 不能被舊的 SUCCESS 蓋掉。
[.statusCheckRollup[] | select(.name == "verify")]
| sort_by(.startedAt // "9999")
| last
| (.conclusion // "")
