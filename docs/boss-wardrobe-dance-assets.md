# 好兄弟服装与花样游泳素材

本次素材使用 OpenAI 内置 imagegen 生成与编辑。人脸参考为用户提供的照片，照片原件没有复制进项目。下方路径均相对于项目根目录。

## 新增动作

- `web/boss-show-dance-more-v1.png`：新增一组 4×2 动作帧，用于划臂、屈膝、舒展、抱膝和交替踢腿。

生成提示词：

> Use case: identity-preserve. Asset type: new 8-frame transparent sprite sheet for the SAME realistic top-down synchronized-swimming pond character. Image 1 is the existing animation/reference sheet; image 2 is the man's exact face and thin round glasses. Make a new distinctly different set of EIGHT anatomically connected, complete full-body poses arranged in a precise FOUR equal columns by TWO equal rows grid. Same facial identity, messy black hair, off-white sleeveless vest, loose charcoal shorts, bare feet; same top-down camera and same torso center and consistent scale. Depict a coherent graceful synchronized swimming sequence visible from directly above: 1 relaxed backfloat arms open legs straight, 2 both arms gently scull outward with one knee bent, 3 legs make a broad V and arms sweep overhead, 4 arms curve together into an oval with knees tucked, 5 extend into a starfish, 6 one arm reaches diagonally while legs form scissors, 7 body lengthens and arms return outward, 8 same backfloat as frame 1 so it loops. Clearly different gestures, no detached limbs; expression relaxed and face visible naturally, exactly two arms and two legs. Keep all figures well within individual cells with at least 10% empty transparent margin on every side, no overlap, no grid, no backdrop, no water, no leaf, no text, no floating fragments. Photo-realistic, soft diffuse daylight, natural adult proportions.

## 东北大花套装

`web/boss-floral-relax-v1.png` 是服装参考，提示词：

> Use case: identity-preserve. Edit target: image 1, the isolated overhead pond-game character. Identity reference: image 2. Change ONLY the outfit to a playful authentic northeastern Chinese 大花袄 and 大花裤衩 set: a slightly padded long-sleeved traditional cotton jacket with a vivid deep red background covered in large pink, yellow and white peony flowers with green leaves, Chinese fabric texture and subtle dark trim; matching loose knee-length floral shorts in the SAME red peony fabric. Bare lower legs, bare feet and hands. Preserve the EXACT same man, recognizable face, glasses, messy black hair, body position, left hand behind head, crossed leg, proportions, camera, body size and placement from image 1; natural relaxed overhead photorealism. Keep the entire person inside frame. Genuine clean transparent background, no leaf, no water, no background, no text, no extra limbs. Do not alter the pose.

下列文件由对应的原动作和上面的服装参考图编辑得到：

| 原动作 | 新素材 |
| --- | --- |
| 坐姿 | `web/boss-floral-sitting-v1.png` |
| 躺坐过渡 | `web/boss-floral-cycle-v2.png` |
| 蛙泳 | `web/boss-floral-swim-cycle-v1.png` |
| 抖脚 | `web/boss-floral-foot-v2.png` |
| 摸脚 | `web/boss-floral-scratch-v2.png` |
| 拨水 | `web/boss-floral-water-v2.png` |
| 攀爬 | `web/boss-floral-climb-v1.png` |
| 跳水 | `web/boss-floral-dive-v2.png` |
| 原花样游泳动作 | `web/boss-floral-dance-v1.png` |
| 新花样游泳动作 | `web/boss-floral-dance-more-v1.png` |

共同编辑提示词：

> Use case: identity-preserve. Image 1 is the exact edit target; image 2 is the wardrobe and identity reference. Change ONLY the white vest and gray shorts in image 1 into the EXACT same Chinese northeastern floral costume shown in image 2: red quilted long-sleeved jacket with pink/yellow/white large peonies and green leaves, dark piping, matching red floral loose knee-length shorts; keep hands and legs/feet bare. Every person must wear BOTH matching floral garments in every frame. Preserve facial identity, glasses, head, anatomy, hands, feet, camera angle, transparent margins, pose, size, orientation and exact grid layout of image 1. Keep every complete human inside its own cell with no overlap. Photorealistic soft daylight. Genuinely clean transparent background with no water, leaf, letters, borders, grid, floating body parts, white backing, haze or shadows.

每张图还单独注明了要保留的原动作。新花样动作的背景另用 imagegen 去除：仅移除人物周围的底色和阴影，保持八个人物、服装、姿势和网格位置不变。

## 大花袄的揣袖躺姿

根据后续要求，`web/boss-floral-relax-v2.png` 替换初版枕手躺姿，使用同一个人脸、大花服装、翘腿和俯拍视角，双臂在胸腹前交叉、双手分别揣入对侧袖口，不再有手臂枕在脑后。

抖脚、摸脚、拨水、躺坐过渡和跳水分别从对应初版动作与新的揣袖躺姿编辑得到。各组均保持原来的网格、人物大小和人脸，要求起始与结束姿态衔接揣袖休息；摸脚和拨水的中间帧让一只手自然从袖口伸出完成动作，再收回。抖脚时双手始终揣袖，起身和跳水时双手可自然离开袖口参与动作。

拨水图的透明背景另作一次 imagegen 提取，提示词：

> Use case: background-extraction. Remove ONLY all gray, white and red haze, glow, backdrop and shadows around and between the eight people in this 4-column by 2-row animation sheet. Make all non-human pixels fully transparent. Preserve all eight people exactly: same faces, glasses, red peony floral jacket and shorts, crossed legs, hands tucked in sleeves at start and end and the arm reaching outward in middle frames, anatomy, poses, scale, exact grid positions. No water, leaf, text, border, no new or detached limbs.
