app.post("/api/unsubscribe", async (req, res) => {
    const { email, newsletterId, motivo } = req.body;

    if (!email || !newsletterId) {
        return res.status(400).send("Dados incompletos.");
    }

    const snap = await db.collection("leads").where("email", "==", email).get();
    if (snap.empty) return res.status(404).send("Lead não encontrado.");

    const leadRef = snap.docs[0].ref;

    await leadRef.update({
        receber_newsletter: false,
        status: "Descartado"
    });

    await leadRef.collection("descadastramentos").add({
        newsletter_id: newsletterId,
        motivo: motivo || null,
        data: firebase.firestore.Timestamp.now()
    });

    res.send("Você foi descadastrado com sucesso.");
});
