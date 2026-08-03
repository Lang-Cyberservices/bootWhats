<?php

declare(strict_types=1);

namespace Gestao\Controllers;

use Gestao\Repositories\CountryRepository;
use PDOException;

final class CountryController
{
    public function __construct(private CountryRepository $countries)
    {
    }

    public function index(): void
    {
        $error = null;
        $success = null;
        $selectedId = (int) ($_GET['id'] ?? 0);

        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $action = (string) ($_POST['action'] ?? '');
            [$error, $success, $selectedId] = $this->handlePost($action);
        }

        $countries = $this->countries->listAll();

        $country = $selectedId > 0 ? $this->countries->findById($selectedId) : null;
        if ($country === null) {
            $selectedId = 0;
        }

        require __DIR__ . '/../Views/countries.php';
    }

    /** @return array{0:string|null,1:string|null,2:int} */
    private function handlePost(string $action): array
    {
        $name = trim((string) ($_POST['name'] ?? ''));
        $sigla = trim((string) ($_POST['sigla'] ?? ''));
        $description = trim((string) ($_POST['description'] ?? ''));
        $flag = trim((string) ($_POST['flag'] ?? ''));

        if ($name === '' || $sigla === '') {
            return ['Preencha nome e sigla.', null, 0];
        }

        $description = $description !== '' ? $description : null;
        $flag = $flag !== '' ? $flag : null;

        try {
            if ($action === 'update') {
                $id = (int) ($_POST['id'] ?? 0);
                if ($id <= 0) {
                    return ['Pais invalido.', null, 0];
                }

                $this->countries->update($id, $name, $sigla, $description, $flag);
                return [null, 'Pais atualizado.', $id];
            }

            $this->countries->create($name, $sigla, $description, $flag);
            return [null, 'Pais cadastrado.', 0];
        } catch (PDOException $e) {
            if ((int) $e->getCode() === 23000) {
                return ['Ja existe um pais cadastrado com essa sigla.', null, 0];
            }

            throw $e;
        }
    }
}
