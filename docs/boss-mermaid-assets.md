# 好兄弟美人鱼表演素材

`web/boss-mermaid-v1.png` 是用于音乐表演的单张透明人物素材；非表演时仍使用用户选择的原服装。人脸参考为用户提供的 `2024-12-19 151026.jpg`，姿态和画风参考项目已有的 `web/boss-show-dance-more-v1.png`。

生成提示：

> Use case: identity-preserve. Create a single transparent full-body game character sprite for the existing overhead pond wallpaper. Image 1 is the EXACT adult man's face identity reference; image 2 is the existing game's visual style and overhead body proportions (use only its first, top-left T-pose person as pose reference, NOT the grid). Depict that SAME recognizable adult man with the same thin round metal glasses and slightly messy short black hair, seen directly from above with his face naturally visible. He is in a playful mermaid performance COSTUME: the familiar off-white sleeveless tank top, a small tasteful scallop-shell and seaweed collar, and one long emerald-teal fish-tail costume with realistic overlapping scales, seamlessly covering his body from waist down and ending in one graceful broad forked fin. NO human legs, feet, extra limbs, or exposed lower body. Head at top, straight torso centred, arms relaxed outward horizontally and connected to shoulders, natural hands, tail extends straight down with the fin visible. This is an animation source: all parts must be fully inside one square image with generous clear margins, normal proportions and a centred, mostly symmetrical pose; not cropped. Photorealistic but gently whimsical, softly lit to match the existing pond scene. Output genuine clean transparency on every non-character pixel: no water, leaf, shadows, border, backdrop, words, grid, haze or loose accessories.

透明边缘清理提示：

> Edit the attached transparent-background character sprite. Keep the SAME man's face, glasses, body, tank top, shell collar, green mermaid tail, pose, exact placement, and photorealistic game art. Fix ONLY the edge cutout: remove all red, yellow and green colored fringe pixels and any stray colored marks outside the person. Produce a clean natural alpha edge with smooth antialiasing and genuine transparent background, no color halo, no ground, no cast shadow, no other additions. Preserve generous margins and all details.

最终选择的文件为 `exec-f5ca7165-11d0-43e3-8aff-57292b146a3e.png`。角色的动作在运行时由连续网格形变产生，不依赖切换多张人物图片。
