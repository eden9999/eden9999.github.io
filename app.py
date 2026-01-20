from flask import (
    Flask,
    request,
    render_template,
    redirect,
    url_for,
    send_from_directory,
)
import os
import json
import pandas as pd

from werkzeug.utils import secure_filename


app = Flask(__name__)


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_FOLDER = os.path.join(BASE_DIR, "uploads")
PROJECTS_DIR = os.path.join(BASE_DIR, "projects")
BULK_DIR = os.path.join(PROJECTS_DIR, "bulk")
SCRNA_DIR = os.path.join(PROJECTS_DIR, "scrna")

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(BULK_DIR, exist_ok=True)
os.makedirs(SCRNA_DIR, exist_ok=True)


# ---------- helpers ----------


def project_dir(name, mode="bulk"):
    base = BULK_DIR if mode == "bulk" else SCRNA_DIR
    return os.path.join(base, name)


def project_files_dir(name, mode="bulk"):
    return os.path.join(project_dir(name, mode), "files")


def project_meta_path(name, mode="bulk"):
    return os.path.join(project_dir(name, mode), "meta.json")


def load_projects(mode="bulk"):
    projects = {}
    base = BULK_DIR if mode == "bulk" else SCRNA_DIR
    if not os.path.isdir(base):
        return projects
    for p in os.listdir(base):
        meta = project_meta_path(p, mode)
        if os.path.isfile(meta):
            with open(meta, "r") as f:
                data = json.load(f)
            projects[p] = data.get("files", [])
    return projects


def ensure_project(name, mode="bulk"):
    os.makedirs(project_files_dir(name, mode), exist_ok=True)
    meta = project_meta_path(name, mode)
    if not os.path.isfile(meta):
        with open(meta, "w") as f:
            json.dump({"files": []}, f)


# ---------- routes ----------
# ---------- login ----------


@app.route("/", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        # minimal placeholder authentication
        username = request.form.get("username", "")
        password = request.form.get("password", "")
        if username and password:
            return redirect(url_for("home"))
    return render_template("login.html")


# ---------- home ----------
@app.route("/home")
def home():
    return render_template("home.html")


@app.route("/projects")
def projects_index():
    return render_template("project.html")


# ---------- projects ----------

# ---------- project persistent storage (metadata + images) ----------


def project_store_dir(name):
    base = os.path.join(PROJECTS_DIR, "store")
    os.makedirs(base, exist_ok=True)
    pdir = os.path.join(base, name)
    os.makedirs(pdir, exist_ok=True)
    os.makedirs(os.path.join(pdir, "images"), exist_ok=True)
    return pdir


def project_store_json(name):
    return os.path.join(project_store_dir(name), "project.json")


@app.route("/api/project/<name>/save", methods=["POST"])
def api_project_save(name):
    data = request.get_json(force=True, silent=True)
    if data is None:
        return {"error": "no data"}, 400
    with open(project_store_json(name), "w") as f:
        json.dump(data, f, indent=2)
    return {"status": "ok"}


@app.route("/api/project/<name>/load")
def api_project_load(name):
    path = project_store_json(name)
    if not os.path.isfile(path):
        return {}
    with open(path, "r") as f:
        return json.load(f)


# Alias routes for legacy frontend
@app.route("/project/save/<name>", methods=["POST"])
def project_save_alias(name):
    return api_project_save(name)


@app.route("/project/load/<name>")
def project_load_alias(name):
    return api_project_load(name)


@app.route("/api/project/<name>/upload_image", methods=["POST"])
def api_project_upload_image(name):
    if "file" not in request.files:
        return {"error": "no file"}, 400
    file = request.files["file"]
    if not file.filename:
        return {"error": "empty filename"}, 400

    fname = secure_filename(file.filename)
    img_dir = os.path.join(project_store_dir(name), "images")
    save_path = os.path.join(img_dir, fname)
    file.save(save_path)

    return {
        "status": "ok",
        "filename": fname,
        "url": f"/projects_store/{name}/images/{fname}",
    }


@app.route("/projects_store/<project>/images/<path:filename>")
def serve_project_store_image(project, filename):
    return send_from_directory(
        os.path.join(project_store_dir(project), "images"), filename
    )


@app.route("/projects/<name>")
def project_page(name):
    state = {}
    path = project_store_json(name)
    if os.path.isfile(path):
        with open(path, "r") as f:
            state = json.load(f)
    return render_template("my_project.html", project=name, initial_state=state)


@app.route("/analysis")
def analysis():
    bulk_projects = load_projects(mode="bulk")
    scrna_projects = load_projects(mode="scrna")
    return render_template(
        "analysis.html",
        view="projects",
        bulk_projects=bulk_projects,
        scrna_projects=scrna_projects,
    )


# ---------- analysis ----------
@app.route("/Aproject/<project>")
def Aproject_view(project):
    mode = request.args.get("mode", "bulk").lower()
    if mode not in ("bulk", "scrna"):
        mode = "bulk"

    ensure_project(project, mode)

    meta = project_meta_path(project, mode)
    with open(meta, "r") as f:
        files = json.load(f).get("files", [])

    if mode == "scrna":
        return render_template(
            "scrna.html",
            view="files",
            project=project,
            files=files,
            mode="scrna",
        )

    return render_template(
        "bulk.html",
        view="files",
        project=project,
        files=files,
        mode="bulk",
    )


@app.route("/upload", methods=["POST"])
def upload():
    project = request.form.get("project", "").strip()
    mode = request.form.get("mode", "bulk").lower()
    file = request.files.get("file")

    if mode not in ("bulk", "scrna"):
        mode = "bulk"

    if not project or not file:
        return redirect(url_for("analysis"))

    ensure_project(project, mode)

    save_path = os.path.join(project_files_dir(project, mode), file.filename)
    file.save(save_path)

    meta = project_meta_path(project, mode)
    with open(meta, "r") as f:
        data = json.load(f)

    if file.filename not in data.get("files", []):
        data.setdefault("files", []).append(file.filename)

    with open(meta, "w") as f:
        json.dump(data, f, indent=2)

    return redirect(url_for("Aproject_view", project=project, mode=mode))


@app.route("/uploads/<path:filename>")
def uploads(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)


@app.route("/projects/<mode>/<project>/files/<path:filename>")
def project_file_with_mode(mode, project, filename):
    mode = (mode or "bulk").lower()
    if mode not in ("bulk", "scrna"):
        return "", 404
    return send_from_directory(project_files_dir(project, mode), filename)


@app.route("/projects/<project>/files/<path:filename>")
def project_file(project, filename):
    mode = request.args.get("mode", "bulk").lower()
    if mode not in ("bulk", "scrna"):
        mode = "bulk"
    return send_from_directory(project_files_dir(project, mode), filename)


# DataTables server-side endpoint for CSVs
@app.route("/datatable", methods=["POST"])
def datatable():
    # DataTables parameters
    draw = int(request.form.get("draw", 1))
    start = int(request.form.get("start", 0))
    length = int(request.form.get("length", 10))
    search_value = request.form.get("search[value]", "")

    csv_path = request.form.get("csv")
    if not csv_path:
        return {"draw": draw, "recordsTotal": 0, "recordsFiltered": 0, "data": []}

    # csv_path expected like: projects/<mode>/<project>/files/<filename>
    parts = csv_path.split("/")
    if len(parts) != 5:
        return {"draw": draw, "recordsTotal": 0, "recordsFiltered": 0, "data": []}

    _, mode, project, _, filename = parts
    abs_csv = os.path.join(PROJECTS_DIR, mode, project, "files", filename)
    if not os.path.isfile(abs_csv):
        return {"draw": draw, "recordsTotal": 0, "recordsFiltered": 0, "data": []}

    # Load CSV
    df = pd.read_csv(abs_csv)

    records_total = len(df)

    if search_value:
        mask = df.apply(
            lambda row: row.astype(str).str.contains(search_value, case=False).any(),
            axis=1,
        )
        df = df[mask]

    records_filtered = len(df)

    # Pagination
    page = df.iloc[start : start + length]

    data = page.values.tolist()

    return {
        "draw": draw,
        "recordsTotal": records_total,
        "recordsFiltered": records_filtered,
        "data": data,
    }


@app.route("/project/new_bulk", methods=["POST"])
def create_bulk_project():
    name = request.form.get("name", "").strip()
    if not name:
        return redirect(url_for("analysis"))

    ensure_project(name, mode="bulk")
    return redirect(url_for("Aproject_view", project=name, mode="bulk"))


@app.route("/project/new_scrna", methods=["POST"])
def create_scrna_project():
    name = request.form.get("name", "").strip()
    if not name:
        return redirect(url_for("analysis"))

    ensure_project(name, mode="scrna")
    return redirect(url_for("Aproject_view", project=name, mode="scrna"))


@app.route("/project/<project>/delete", methods=["POST"])
def delete_project(project):
    mode = request.form.get("mode") or request.args.get("mode") or "bulk"
    mode = mode.lower()
    if mode not in ("bulk", "scrna"):
        mode = "bulk"

    proj_path = project_dir(project, mode)
    if os.path.isdir(proj_path):
        import shutil

        shutil.rmtree(proj_path)

    return redirect(url_for("analysis"))


@app.route("/delete_csv", methods=["POST"])
def delete_csv():
    data = request.get_json()
    if not data or "path" not in data:
        return {"error": "no path"}, 400

    rel_path = data["path"]

    if not isinstance(rel_path, str) or not rel_path.startswith("projects/"):
        return {"error": "invalid path"}, 400

    parts = rel_path.split("/")
    if len(parts) != 5 or parts[0] != "projects" or parts[3] != "files":
        return {"error": "invalid path structure"}, 400

    _, mode, project, _, filename = parts

    mode = mode.lower()
    if mode not in ("bulk", "scrna"):
        return {"error": "invalid mode"}, 400

    abs_path = os.path.join(PROJECTS_DIR, mode, project, "files", filename)

    if not os.path.isfile(abs_path):
        return {"error": "file not found"}, 404

    try:
        meta_path = project_meta_path(project, mode)
        if os.path.isfile(meta_path):
            with open(meta_path, "r") as f:
                meta = json.load(f)
            if filename in meta.get("files", []):
                meta["files"].remove(filename)
                with open(meta_path, "w") as f:
                    json.dump(meta, f, indent=2)

        os.remove(abs_path)
        return {"status": "ok"}
    except Exception as e:
        return {"error": str(e)}, 500


if __name__ == "__main__":
    app.run(port=8080, debug=True)
