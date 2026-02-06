/**
 * RecruitReveal - 招募揭晓 UI
 * 盲抽村民后逐步揭示属性的动画效果
 */
import { TRAIT_POOL } from '../config/villagers.js';

export class RecruitReveal {
    constructor(gameState, eventBus, uiManager) {
        this.state = gameState;
        this.bus = eventBus;
        this.ui = uiManager;

        this.bus.on('villagerRecruited', (data) => this.showReveal(data.villager));
    }

    /** 显示招募揭晓动画 */
    showReveal(villager) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';

        const isPositive = (trait) => TRAIT_POOL.positive.includes(trait);

        const traitTags = villager.traits.map(t =>
            `<span class="trait-tag ${isPositive(t) ? 'positive' : 'negative'}">${t}</span>`
        ).join('');

        overlay.innerHTML = `
            <div class="modal fade-in" style="max-width:420px;">
                <div class="recruit-reveal">
                    <div class="reveal-title">🎉 新村民加入！</div>
                    <div class="reveal-avatar">👤</div>
                    <div class="reveal-name" id="reveal-name" style="opacity:0;">
                        ${villager.name}
                    </div>
                    <div class="reveal-traits" id="reveal-traits" style="opacity:0;">
                        ${traitTags}
                    </div>
                    <div class="reveal-specialty" id="reveal-specialty" style="opacity:0;">
                        🎯 特长: ${villager.specialty}
                    </div>
                    <div class="reveal-stamina" id="reveal-stamina" style="opacity:0;">
                        💪 体力上限: ${villager.maxStamina}
                    </div>
                    <div class="reveal-tip" id="reveal-tip" style="opacity:0;">
                        口癖: "${villager.quirk}"
                        <br>
                        ${this.getTraitTip(villager.traits)}
                    </div>
                    <div class="modal-actions" id="reveal-actions" style="opacity:0;">
                        <button class="btn btn-primary" id="reveal-ok">欢迎加入！ 🎊</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        // 逐步揭示动画
        this.animateReveal(overlay);

        // 关闭按钮
        const okBtn = overlay.querySelector('#reveal-ok');
        okBtn.addEventListener('click', () => overlay.remove());

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });
    }

    /** 逐步揭示 */
    async animateReveal(overlay) {
        const steps = ['reveal-name', 'reveal-traits', 'reveal-specialty', 'reveal-stamina', 'reveal-tip', 'reveal-actions'];

        for (let i = 0; i < steps.length; i++) {
            await new Promise(r => setTimeout(r, 400));
            const el = overlay.querySelector(`#${steps[i]}`);
            if (el) {
                el.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
                el.style.transform = 'translateY(10px)';
                el.style.opacity = '0';
                // 触发 reflow
                void el.offsetHeight;
                el.style.opacity = '1';
                el.style.transform = 'translateY(0)';
            }
        }
    }

    /** 根据性格给提示 */
    getTraitTip(traits) {
        const tips = [];
        if (traits.includes('勤劳')) tips.push('✅ 干活积极，排满工作');
        if (traits.includes('懒惰')) tips.push('⚠️ 喜欢偷懒，多安排休息');
        if (traits.includes('聪明')) tips.push('✅ 执行准确，会给建议');
        if (traits.includes('愚笨')) tips.push('⚠️ 可能做错事，需多盯着');
        if (traits.includes('叛逆')) tips.push('⚠️ 可能拒绝指令');
        if (traits.includes('健壮')) tips.push('✅ 体力充沛');
        if (traits.includes('体弱')) tips.push('⚠️ 容易累，注意分配');
        if (traits.includes('乐观')) tips.push('✅ 心情恢复快');
        if (traits.includes('悲观')) tips.push('⚠️ 容易抱怨');

        return tips.join('<br>') || '普通村民，中规中矩';
    }
}
